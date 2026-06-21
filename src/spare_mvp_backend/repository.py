"""SQLite repository helpers for application contract persistence."""

from __future__ import annotations

import json
import hashlib
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def initialize_database(connection: sqlite3.Connection) -> None:
    """Create the PR-D persistence schema in an existing SQLite connection."""
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _relax_simulation_run_scenario_constraints(connection)
    _ensure_column(connection, "simulation_runs", "created_by", "TEXT")
    _ensure_column(connection, "simulation_runs", "lifecycle_status", "TEXT NOT NULL DEFAULT 'active'")
    _ensure_column(connection, "simulation_runs", "archived_at", "TEXT")
    _ensure_column(connection, "simulation_runs", "deleted_at", "TEXT")
    connection.execute(
        """
        UPDATE simulation_runs
        SET lifecycle_status = 'active'
        WHERE lifecycle_status IS NULL OR lifecycle_status = ''
        """
    )
    _ensure_column(connection, "users", "password_hash", "TEXT")
    _ensure_column(connection, "users", "display_name", "TEXT")
    _ensure_column(connection, "users", "status", "TEXT NOT NULL DEFAULT 'active'")
    _ensure_column(connection, "experiment_plans", "modeling_snapshot_id", "TEXT")
    _ensure_column(connection, "modeling_imports", "draft_payload_json", "TEXT")
    _ensure_column(connection, "modeling_imports", "published_payload_json", "TEXT")
    _seed_m4_users(connection)
    connection.commit()


class ContractRepository:
    """Persist contract objects without interpreting Mesa simulation semantics."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def get_user_by_username(self, username: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT user_id, username, password_hash, role, display_name, status, created_at
            FROM users
            WHERE username = ?
            """,
            (username,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(username)
        return _row_to_dict(cursor, row)

    def list_users(self) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT user_id, username, password_hash, role, display_name, status, created_at
            FROM users
            ORDER BY username ASC
            """
        )
        return [_row_to_dict(cursor, row) for row in cursor.fetchall()]

    def list_projects(self) -> list[dict[str, Any]]:
        cursor = self.connection.execute(
            """
            SELECT project_id, payload_json, updated_at
            FROM projects
            ORDER BY datetime(updated_at) DESC
            """
        )
        projects = []
        for row in cursor.fetchall():
            project_payload = json.loads(row[1]) if row[1] else {}
            if not isinstance(project_payload, dict):
                project_payload = {}
            projects.append({
                "project_id": row[0],
                **project_payload,
                "updated_at": row[2],
            })
        return projects

    def get_user(self, user_id: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT user_id, username, password_hash, role, display_name, status, created_at
            FROM users
            WHERE user_id = ?
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(user_id)
        return _row_to_dict(cursor, row)

    def create_user(self, user: dict[str, Any]) -> dict[str, Any]:
        username = str(_required(user, "username")).strip()
        if not username:
            raise ValueError("username is required")
        try:
            self.get_user_by_username(username)
        except KeyError:
            pass
        else:
            raise ValueError(f"user already exists: {username}")

        user_id = str(user.get("user_id") or f"user-{_stable_hash({'username': username})}")
        password = str(user.get("password") or username)
        role = str(user.get("role") or "普通用户")
        display_name = str(user.get("display_name") or user.get("name") or username)
        status = _normalize_user_status(str(user.get("status") or "active"))
        self.connection.execute(
            """
            INSERT INTO users (user_id, username, password_hash, role, display_name, status)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, username, _password_hash(password), role, display_name, status),
        )
        self.connection.commit()
        return self.get_user(user_id)

    def update_user(self, user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        current = self.get_user(user_id)
        username = str(updates.get("username") or current["username"]).strip()
        if not username:
            raise ValueError("username is required")
        if username != current["username"]:
            try:
                self.get_user_by_username(username)
            except KeyError:
                pass
            else:
                raise ValueError(f"user already exists: {username}")
        password_hash = current.get("password_hash")
        if "password" in updates and str(updates.get("password") or ""):
            password_hash = _password_hash(str(updates["password"]))
        role = str(updates.get("role") or current["role"])
        display_name = str(updates.get("display_name") or updates.get("name") or current.get("display_name") or username)
        status = _normalize_user_status(str(updates.get("status") or current.get("status") or "active"))
        self.connection.execute(
            """
            UPDATE users
            SET username = ?, password_hash = ?, role = ?, display_name = ?, status = ?
            WHERE user_id = ?
            """,
            (username, password_hash, role, display_name, status, user_id),
        )
        self.connection.commit()
        return self.get_user(user_id)

    def create_session(self, user_id: str) -> dict[str, Any]:
        user = self.get_user(user_id)
        token = f"m4-{secrets.token_urlsafe(24)}"
        self.connection.execute(
            """
            INSERT INTO sessions (session_token, user_id)
            VALUES (?, ?)
            """,
            (token, user_id),
        )
        self.connection.commit()
        return {
            "token": token,
            "user_id": user_id,
            "role": user["role"],
        }

    def get_session_user(self, session_token: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT u.user_id, u.username, u.password_hash, u.role, u.display_name, u.status, u.created_at
            FROM sessions s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.session_token = ?
            """,
            (session_token,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(session_token)
        return _row_to_dict(cursor, row)

    def insert_audit_event(
        self,
        *,
        actor_user_id: str | None,
        action: str,
        resource_type: str,
        resource_id: str,
        outcome: str,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event = self._insert_audit_event_no_commit(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            details=details,
        )
        self.connection.commit()
        return event

    def _insert_audit_event_no_commit(
        self,
        *,
        actor_user_id: str | None,
        action: str,
        resource_type: str,
        resource_id: str,
        outcome: str,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event = {
            "audit_event_id": f"audit-{uuid4()}",
            "actor_user_id": actor_user_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "outcome": outcome,
            "details": details or {},
        }
        self.connection.execute(
            """
            INSERT INTO audit_events (
              audit_event_id, actor_user_id, action, resource_type,
              resource_id, outcome, details_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["audit_event_id"],
                event["actor_user_id"],
                event["action"],
                event["resource_type"],
                event["resource_id"],
                event["outcome"],
                _to_json(event["details"]),
            ),
        )
        return event

    def list_audit_events(self, resource_id: str | None = None) -> list[dict[str, Any]]:
        query = """
            SELECT rowid, audit_event_id, actor_user_id, action, resource_type,
                   resource_id, outcome, details_json, created_at
            FROM audit_events
        """
        params: tuple[Any, ...] = ()
        if resource_id is not None:
            query += " WHERE resource_id = ?"
            params = (resource_id,)
        query += " ORDER BY rowid ASC"
        cursor = self.connection.execute(query, params)
        events = []
        for row in cursor.fetchall():
            event = _row_to_dict(cursor, row)
            event.pop("rowid", None)
            event["details"] = json.loads(event.pop("details_json"))
            events.append(event)
        return events

    def upsert_project(self, project: dict[str, Any]) -> None:
        project_id = _required(project, "project_id")
        schema_version = str(project.get("schema_version") or "project-v0")
        project_version = str(project.get("project_version") or "project-v0.1")
        self.connection.execute(
            """
            INSERT INTO projects (
              project_id, schema_version, project_version, scenario_id,
              active_module, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id) DO UPDATE SET
              schema_version = excluded.schema_version,
              project_version = excluded.project_version,
              scenario_id = excluded.scenario_id,
              active_module = excluded.active_module,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                project_id,
                schema_version,
                project_version,
                project.get("scenarioId"),
                project.get("activeModule"),
                _to_json(project),
            ),
        )
        self.connection.commit()

    def upsert_modeling_import(self, import_package: dict[str, Any], validation: dict[str, Any]) -> None:
        payload = _modeling_import_payload(import_package, validation)
        existing = self._get_modeling_import_row(payload["importId"])
        lifecycle = payload.get("lifecycle", {})
        state = str(lifecycle.get("state") or "draft")
        if state == "published" and existing and existing.get("published_payload_json"):
            self.assert_modeling_import_can_publish(payload["importId"])
        draft_payload_json = _to_json(payload)
        published_payload_json = (existing or {}).get("published_payload_json")
        if state == "published":
            published_payload_json = _to_json(payload)
        referenced_run_ids = lifecycle.get("referencedRunIds") or []
        if state != "published" and existing and existing.get("referenced_run_ids_json"):
            referenced_run_ids = json.loads(existing["referenced_run_ids_json"])
        self.connection.execute(
            """
            INSERT INTO modeling_imports (
              import_id, project_id, schema_version, import_version, status,
              validation_status, referenced_run_ids_json, payload_json,
              draft_payload_json, published_payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(import_id) DO UPDATE SET
              project_id = excluded.project_id,
              schema_version = excluded.schema_version,
              import_version = excluded.import_version,
              status = excluded.status,
              validation_status = excluded.validation_status,
              referenced_run_ids_json = excluded.referenced_run_ids_json,
              payload_json = excluded.payload_json,
              draft_payload_json = excluded.draft_payload_json,
              published_payload_json = COALESCE(excluded.published_payload_json, modeling_imports.published_payload_json),
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                _required(payload, "importId"),
                _required(payload, "projectId"),
                _required(payload, "schemaVersion"),
                int(lifecycle.get("version") or 1),
                state,
                str(validation.get("status") or ("valid" if validation.get("ok") else "invalid")),
                json.dumps(referenced_run_ids, ensure_ascii=False, sort_keys=True),
                _to_json(payload),
                draft_payload_json,
                published_payload_json,
            ),
        )
        self.connection.commit()

    def get_modeling_import(self, import_id: str) -> dict[str, Any]:
        row = self._get_modeling_import_row(import_id)
        if row is None:
            raise KeyError(import_id)
        draft_package = _json_or_none(row.get("draft_payload_json")) or _json_or_none(row.get("payload_json"))
        published_package = _json_or_none(row.get("published_payload_json"))
        current_package = draft_package or published_package
        if current_package is None:
            raise KeyError(import_id)
        validation = current_package.get("validation") or {"ok": row.get("validation_status") == "valid", "status": row.get("validation_status"), "issues": []}
        lifecycle = current_package.get("lifecycle", {})
        return {
            "importId": import_id,
            "projectId": current_package.get("projectId") or row.get("project_id"),
            "schemaVersion": current_package.get("schemaVersion") or row.get("schema_version"),
            "lifecycle": lifecycle,
            "validation": validation,
            "draftPackage": draft_package,
            "publishedPackage": published_package,
        }

    def assert_modeling_import_can_publish(self, import_id: str) -> None:
        stored = self.get_modeling_import(import_id)
        lifecycle = (stored.get("publishedPackage") or {}).get("lifecycle", {})
        referenced_run_ids = lifecycle.get("referencedRunIds") or json.loads((self._get_modeling_import_row(import_id) or {}).get("referenced_run_ids_json") or "[]")
        if lifecycle.get("state") == "published" and lifecycle.get("referencedRunIds"):
            raise ValueError(f"published modeling import is referenced by runs: {', '.join(lifecycle['referencedRunIds'])}")
        if referenced_run_ids:
            raise ValueError(f"published modeling import is referenced by runs: {', '.join(referenced_run_ids)}")

    def publish_modeling_import(self, import_id: str) -> dict[str, Any]:
        self.assert_modeling_import_can_publish(import_id)
        stored = self.get_modeling_import(import_id)
        draft = stored.get("draftPackage") or stored.get("publishedPackage")
        if draft is None:
            raise KeyError(import_id)
        lifecycle = {
            **draft.get("lifecycle", {}),
            "state": "published",
        }
        published = {**json.loads(_to_json(draft)), "lifecycle": lifecycle}
        validation = published.get("validation") or stored.get("validation") or {"ok": True, "status": "valid", "issues": []}
        self.upsert_modeling_import(published, validation)
        return self.get_modeling_import(import_id)

    def get_published_modeling_import(self, import_id: str) -> dict[str, Any]:
        stored = self.get_modeling_import(import_id)
        published = stored.get("publishedPackage")
        if published is None:
            raise KeyError(import_id)
        return published

    def upsert_experiment_plan(self, plan: dict[str, Any]) -> None:
        self.connection.execute(
            """
            INSERT INTO experiment_plans (
              experiment_plan_id, project_id, modeling_snapshot_id, schema_version, project_version,
              status, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(experiment_plan_id) DO UPDATE SET
              project_id = excluded.project_id,
              modeling_snapshot_id = excluded.modeling_snapshot_id,
              schema_version = excluded.schema_version,
              project_version = excluded.project_version,
              status = excluded.status,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                _required(plan, "experiment_plan_id"),
                _required(plan, "project_id"),
                plan.get("modeling_snapshot_id"),
                _required(plan, "schema_version"),
                _required(plan, "project_version"),
                plan.get("status", "draft"),
                _to_json(plan),
            ),
        )
        self.connection.commit()

    def upsert_modeling_snapshot(self, snapshot: dict[str, Any]) -> None:
        self.connection.execute(
            """
            INSERT INTO modeling_snapshots (
              snapshot_id, project_id, schema_version, project_version, payload_json
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(snapshot_id) DO UPDATE SET
              project_id = excluded.project_id,
              schema_version = excluded.schema_version,
              project_version = excluded.project_version,
              payload_json = excluded.payload_json
            """,
            (
                _required(snapshot, "snapshot_id"),
                _required(snapshot, "project_id"),
                _required(snapshot, "schema_version"),
                _required(snapshot, "project_version"),
                _to_json(snapshot),
            ),
        )
        self.connection.commit()

    def upsert_scenario(self, scenario: dict[str, Any]) -> None:
        model = scenario.get("simulation_model", {})
        self.connection.execute(
            """
            INSERT INTO scenarios (
              scenario_id, project_id, schema_version, scenario_version,
              simulation_model_family, simulation_model_id, mesa_contract_version,
              compiled_by, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scenario_id) DO UPDATE SET
              project_id = excluded.project_id,
              schema_version = excluded.schema_version,
              scenario_version = excluded.scenario_version,
              simulation_model_family = excluded.simulation_model_family,
              simulation_model_id = excluded.simulation_model_id,
              mesa_contract_version = excluded.mesa_contract_version,
              compiled_by = excluded.compiled_by,
              payload_json = excluded.payload_json
            """,
            (
                _required(scenario, "scenario_id"),
                _required(scenario, "project_id"),
                _required(scenario, "schema_version"),
                _required(scenario, "scenario_version"),
                _required(model, "family"),
                _required(model, "model_id"),
                model.get("contract_version"),
                scenario.get("compiled_by"),
                _to_json(scenario),
            ),
        )
        self.connection.commit()

    def upsert_run(self, run: dict[str, Any]) -> None:
        stored_run = dict(run)
        stored_run["created_by"] = stored_run.get("created_by") or "system"
        stored_run["lifecycle_status"] = stored_run.get("lifecycle_status") or "active"
        self.connection.execute(
            """
            INSERT INTO simulation_runs (
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, created_by, lifecycle_status,
              archived_at, deleted_at, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(run_id) DO UPDATE SET
              project_id = excluded.project_id,
              experiment_plan_id = excluded.experiment_plan_id,
              scenario_id = excluded.scenario_id,
              scenario_version = excluded.scenario_version,
              schema_version = excluded.schema_version,
              model_family = excluded.model_family,
              model_id = excluded.model_id,
              status = excluded.status,
              run_type = excluded.run_type,
              seed = excluded.seed,
              result_summary_id = excluded.result_summary_id,
              artifact_manifest_id = excluded.artifact_manifest_id,
              created_by = excluded.created_by,
              lifecycle_status = excluded.lifecycle_status,
              archived_at = excluded.archived_at,
              deleted_at = excluded.deleted_at,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                _required(stored_run, "run_id"),
                _required(stored_run, "project_id"),
                stored_run.get("experiment_plan_id"),
                stored_run.get("scenario_id"),
                stored_run.get("scenario_version"),
                _required(stored_run, "schema_version"),
                _required(stored_run, "model_family"),
                _required(stored_run, "model_id"),
                _required(stored_run, "status"),
                stored_run.get("run_type"),
                stored_run.get("seed"),
                stored_run.get("result_summary_id"),
                _required(stored_run, "artifact_manifest_id"),
                stored_run["created_by"],
                stored_run["lifecycle_status"],
                stored_run.get("archived_at"),
                stored_run.get("deleted_at"),
                _to_json(stored_run),
            ),
        )
        self.connection.commit()

    def upsert_result_summary(self, result: dict[str, Any]) -> None:
        self.connection.execute(
            """
            INSERT INTO result_summaries (
              result_summary_id, run_id, scenario_id, scenario_version,
              schema_version, model_family, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(result_summary_id) DO UPDATE SET
              run_id = excluded.run_id,
              scenario_id = excluded.scenario_id,
              scenario_version = excluded.scenario_version,
              schema_version = excluded.schema_version,
              model_family = excluded.model_family,
              payload_json = excluded.payload_json
            """,
            (
                _required(result, "result_id"),
                _required(result, "run_id"),
                _required(result, "scenario_id"),
                result.get("scenario_version"),
                _required(result, "schema_version"),
                _required(result, "model_family"),
                _to_json(result),
            ),
        )
        self.connection.commit()

    def upsert_artifact_manifest(self, manifest: dict[str, Any]) -> None:
        self.connection.execute(
            """
            INSERT INTO artifact_manifests (
              artifact_manifest_id, run_id, scenario_id, scenario_version,
              schema_version, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(artifact_manifest_id) DO UPDATE SET
              run_id = excluded.run_id,
              scenario_id = excluded.scenario_id,
              scenario_version = excluded.scenario_version,
              schema_version = excluded.schema_version,
              payload_json = excluded.payload_json
            """,
            (
                _required(manifest, "artifact_manifest_id"),
                _required(manifest, "run_id"),
                manifest.get("scenario_id"),
                manifest.get("scenario_version"),
                _required(manifest, "schema_version"),
                _to_json(manifest),
            ),
        )
        self.connection.commit()

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._get_payload("projects", "project_id", project_id)

    def get_experiment_plan(self, experiment_plan_id: str) -> dict[str, Any]:
        return self._get_payload("experiment_plans", "experiment_plan_id", experiment_plan_id)

    def get_modeling_snapshot(self, snapshot_id: str) -> dict[str, Any]:
        return self._get_payload("modeling_snapshots", "snapshot_id", snapshot_id)

    def get_latest_modeling_snapshot(self, project_id: str) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            """
            SELECT payload_json
            FROM modeling_snapshots
            WHERE project_id = ?
            ORDER BY created_at DESC, snapshot_id DESC
            LIMIT 1
            """,
            (project_id,),
        )
        row = cursor.fetchone()
        return None if row is None else json.loads(row[0])

    def next_modeling_snapshot_id(self, project_id: str) -> str:
        prefix = f"modeling-snapshot-{project_id}-"
        cursor = self.connection.execute(
            """
            SELECT snapshot_id
            FROM modeling_snapshots
            WHERE project_id = ?
              AND snapshot_id LIKE ?
            """,
            (project_id, f"{prefix}%"),
        )
        max_sequence = 0
        for (snapshot_id,) in cursor.fetchall():
            suffix = str(snapshot_id).removeprefix(prefix)
            if suffix.isdigit():
                max_sequence = max(max_sequence, int(suffix))
        return f"{prefix}{max_sequence + 1:04d}"

    def next_run_id(self, scenario_id: str) -> str:
        prefix = f"run-{scenario_id}-"
        cursor = self.connection.execute(
            """
            SELECT run_id
            FROM simulation_runs
            WHERE run_id LIKE ?
            """,
            (f"{prefix}%",),
        )
        max_sequence = 0
        for (run_id,) in cursor.fetchall():
            suffix = str(run_id).removeprefix(prefix)
            if suffix.isdigit():
                max_sequence = max(max_sequence, int(suffix))
        return f"{prefix}{max_sequence + 1:04d}"

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self._get_payload("simulation_runs", "run_id", run_id)

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def list_runs(
        self,
        *,
        include_deleted: bool = False,
        project_id: str | None = None,
        experiment_plan_id: str | None = None,
        run_type: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 200))
        clauses: list[str] = []
        params: list[Any] = []
        if not include_deleted:
            clauses.append("COALESCE(lifecycle_status, 'active') != ?")
            params.append("deleted")
        if project_id:
            clauses.append("project_id = ?")
            params.append(project_id)
        if experiment_plan_id:
            clauses.append("experiment_plan_id = ?")
            params.append(experiment_plan_id)
        if run_type:
            clauses.append("run_type = ?")
            params.append(run_type)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor = self.connection.execute(
            f"""
            SELECT payload_json
            FROM simulation_runs
            {where}
            ORDER BY COALESCE(updated_at, created_at) DESC, run_id DESC
            LIMIT ?
            """,
            (*params, safe_limit),
        )
        runs: list[dict[str, Any]] = []
        for (payload_json,) in cursor.fetchall():
            run = json.loads(payload_json)
            artifact_count = 0
            artifact_manifest_id = run.get("artifact_manifest_id")
            if artifact_manifest_id:
                artifact_cursor = self.connection.execute(
                    """
                    SELECT payload_json
                    FROM artifact_manifests
                    WHERE artifact_manifest_id = ?
                      AND run_id = ?
                    """,
                    (artifact_manifest_id, run["run_id"]),
                )
                artifact_row = artifact_cursor.fetchone()
                if artifact_row is not None:
                    artifact_count = len(json.loads(artifact_row[0]).get("artifacts") or [])
            runs.append(
                {
                    "run_id": run["run_id"],
                    "project_id": run["project_id"],
                    "experiment_plan_id": run.get("experiment_plan_id"),
                    "run_type": run.get("run_type") or "single",
                    "model_family": run["model_family"],
                    "status": run["status"],
                    "phase": run.get("phase"),
                    "seed": run.get("seed"),
                    "created_by": run.get("created_by") or "system",
                    "queued_at": run.get("queued_at"),
                    "started_at": run.get("started_at"),
                    "completed_at": run.get("completed_at"),
                    "lifecycle_status": run.get("lifecycle_status") or "active",
                    "artifact_count": artifact_count,
                    "artifact_manifest_id": artifact_manifest_id,
                }
            )
        return runs

    def get_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        chain = self.get_run_chain(run_id)
        result_summary = None
        if run.get("result_summary_id"):
            result_summary = self.get_result_summary_for_run(run_id)
        artifact_manifest = self.get_artifact_manifest_for_run(run_id)
        return {
            "run": run,
            "chain": chain,
            "result_summary": result_summary,
            "artifact_manifest": artifact_manifest,
        }

    def archive_run(self, run_id: str, *, archived_by: str = "system") -> dict[str, Any]:
        run = self.get_run(run_id)
        run["lifecycle_status"] = "archived"
        run["archived_at"] = run.get("archived_at") or self._utc_now()
        run["archived_by"] = archived_by
        self.upsert_run(run)
        return self.get_run(run_id)

    def archive_run_with_audit(self, run_id: str, *, actor_user_id: str) -> dict[str, Any]:
        return self._set_run_lifecycle_with_audit(
            run_id,
            lifecycle_status="archived",
            actor_field="archived_by",
            timestamp_field="archived_at",
            actor_user_id=actor_user_id,
            action="runs.archive",
        )

    def soft_delete_run(self, run_id: str, *, deleted_by: str = "system") -> dict[str, Any]:
        run = self.get_run(run_id)
        run["lifecycle_status"] = "deleted"
        run["deleted_at"] = run.get("deleted_at") or self._utc_now()
        run["deleted_by"] = deleted_by
        self.upsert_run(run)
        return self.get_run(run_id)

    def soft_delete_run_with_audit(self, run_id: str, *, actor_user_id: str) -> dict[str, Any]:
        return self._set_run_lifecycle_with_audit(
            run_id,
            lifecycle_status="deleted",
            actor_field="deleted_by",
            timestamp_field="deleted_at",
            actor_user_id=actor_user_id,
            action="runs.delete",
        )

    def _set_run_lifecycle_with_audit(
        self,
        run_id: str,
        *,
        lifecycle_status: str,
        actor_field: str,
        timestamp_field: str,
        actor_user_id: str,
        action: str,
    ) -> dict[str, Any]:
        self.connection.execute("BEGIN")
        try:
            run = self.get_run(run_id)
            run["lifecycle_status"] = lifecycle_status
            run[timestamp_field] = run.get(timestamp_field) or self._utc_now()
            run[actor_field] = actor_user_id
            self.connection.execute(
                """
                UPDATE simulation_runs
                SET lifecycle_status = ?,
                    archived_at = ?,
                    deleted_at = ?,
                    payload_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (
                    run["lifecycle_status"],
                    run.get("archived_at"),
                    run.get("deleted_at"),
                    _to_json(run),
                    run_id,
                ),
            )
            self._insert_audit_event_no_commit(
                actor_user_id=actor_user_id,
                action=action,
                resource_type="run",
                resource_id=run_id,
                outcome="allowed",
                details={"lifecycle_status": lifecycle_status},
            )
        except Exception:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()
        return self.get_run(run_id)

    def get_result_summary_for_run(self, run_id: str) -> dict[str, Any]:
        return self._get_joined_payload(
            """
            SELECT rs.payload_json
            FROM simulation_runs r
            JOIN result_summaries rs
              ON rs.result_summary_id = r.result_summary_id
             AND rs.run_id = r.run_id
            WHERE r.run_id = ?
            """,
            run_id,
        )

    def get_artifact_manifest_for_run(self, run_id: str) -> dict[str, Any]:
        return self._get_joined_payload(
            """
            SELECT am.payload_json
            FROM simulation_runs r
            JOIN artifact_manifests am
              ON am.artifact_manifest_id = r.artifact_manifest_id
             AND am.run_id = r.run_id
            WHERE r.run_id = ?
            """,
            run_id,
        )

    def find_artifact_for_run(self, run_id: str, artifact_id: str) -> dict[str, Any]:
        manifest = self.get_artifact_manifest_for_run(run_id)
        for artifact in manifest.get("artifacts") or []:
            if artifact.get("artifact_id") == artifact_id:
                return artifact
        raise KeyError(artifact_id)

    def get_run_chain(self, run_id: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            """
            SELECT
              p.project_id,
              p.project_version,
              p.schema_version AS project_schema_version,
              ep.experiment_plan_id,
              ep.modeling_snapshot_id,
              s.scenario_id,
              s.scenario_version,
              s.schema_version AS scenario_schema_version,
              r.run_id,
              r.schema_version AS run_schema_version,
              r.payload_json AS run_payload_json,
              r.result_summary_id AS referenced_result_summary_id,
              r.artifact_manifest_id AS referenced_artifact_manifest_id,
              rs.result_summary_id,
              rs.schema_version AS result_schema_version,
              am.artifact_manifest_id,
              am.schema_version AS artifact_manifest_schema_version
            FROM simulation_runs r
            JOIN projects p ON p.project_id = r.project_id
            LEFT JOIN scenarios s ON s.scenario_id = r.scenario_id
            LEFT JOIN experiment_plans ep
              ON ep.experiment_plan_id = r.experiment_plan_id
            LEFT JOIN result_summaries rs
              ON rs.result_summary_id = r.result_summary_id
             AND rs.run_id = r.run_id
            LEFT JOIN artifact_manifests am
              ON am.artifact_manifest_id = r.artifact_manifest_id
             AND am.run_id = r.run_id
            WHERE r.run_id = ?
            """,
            (run_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(run_id)
        chain = _row_to_dict(cursor, row)
        run_payload = json.loads(chain.pop("run_payload_json"))
        for field in (
            "project_id",
            "project_version",
            "project_schema_version",
            "modeling_snapshot_id",
            "experiment_plan_id",
            "scenario_id",
            "scenario_version",
            "scenario_schema_version",
        ):
            if run_payload.get(field) is not None:
                chain[field] = run_payload[field]
        if chain.get("experiment_plan_id") is None:
            chain.pop("experiment_plan_id", None)
        if chain.get("modeling_snapshot_id") is None:
            chain.pop("modeling_snapshot_id", None)
        if chain["referenced_result_summary_id"] and chain["result_summary_id"] is None:
            raise ValueError(f"identity chain mismatch for result summary on run {run_id}")
        if chain["referenced_artifact_manifest_id"] and chain["artifact_manifest_id"] is None:
            raise ValueError(f"identity chain mismatch for artifact manifest on run {run_id}")
        del chain["referenced_result_summary_id"]
        del chain["referenced_artifact_manifest_id"]
        return chain

    def _get_payload(self, table: str, key_field: str, key: str) -> dict[str, Any]:
        cursor = self.connection.execute(
            f"SELECT payload_json FROM {table} WHERE {key_field} = ?",
            (key,),
        )
        row = cursor.fetchone()
        if row is None:
            raise KeyError(key)
        return json.loads(row[0])

    def _get_joined_payload(self, query: str, key: str) -> dict[str, Any]:
        cursor = self.connection.execute(query, (key,))
        row = cursor.fetchone()
        if row is None:
            raise KeyError(key)
        return json.loads(row[0])

    def _get_modeling_import_row(self, import_id: str) -> dict[str, Any] | None:
        cursor = self.connection.execute(
            """
            SELECT
              import_id,
              project_id,
              schema_version,
              import_version,
              status,
              validation_status,
              referenced_run_ids_json,
              payload_json,
              draft_payload_json,
              published_payload_json
            FROM modeling_imports
            WHERE import_id = ?
            """,
            (import_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return _row_to_dict(cursor, row)


def _required(payload: dict[str, Any], field: str) -> Any:
    value = payload.get(field)
    if value is None:
        raise ValueError(f"missing required field {field!r}")
    return value


def _to_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _json_or_none(value: str | None) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    return json.loads(value)


def _modeling_import_payload(import_package: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
    payload = json.loads(_to_json(import_package))
    payload["validation"] = json.loads(_to_json(validation))
    return payload


def _row_to_dict(cursor: sqlite3.Cursor, row: sqlite3.Row | tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description or [])}


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _relax_simulation_run_scenario_constraints(connection: sqlite3.Connection) -> None:
    columns = {row[1]: row for row in connection.execute("PRAGMA table_info(simulation_runs)")}
    if not columns:
        return
    if not any(columns.get(column, (None, None, None, 0))[3] for column in ("scenario_id", "scenario_version")):
        return

    foreign_keys_enabled = connection.execute("PRAGMA foreign_keys").fetchone()[0]
    connection.execute("PRAGMA foreign_keys = OFF")
    try:
        connection.executescript(
            """
            CREATE TABLE simulation_runs_migrated (
              run_id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              experiment_plan_id TEXT,
              scenario_id TEXT,
              scenario_version TEXT,
              schema_version TEXT NOT NULL,
              model_family TEXT NOT NULL,
              model_id TEXT NOT NULL,
              status TEXT NOT NULL,
              run_type TEXT,
              seed INTEGER,
              result_summary_id TEXT,
              artifact_manifest_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (project_id) REFERENCES projects(project_id),
              FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
            );

            INSERT INTO simulation_runs_migrated (
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, payload_json, created_at, updated_at
            )
            SELECT
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, payload_json, created_at, updated_at
            FROM simulation_runs;

            DROP TABLE simulation_runs;
            ALTER TABLE simulation_runs_migrated RENAME TO simulation_runs;
            """
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute(f"PRAGMA foreign_keys = {'ON' if foreign_keys_enabled else 'OFF'}")


def _seed_m4_users(connection: sqlite3.Connection) -> None:
    users = [
        ("system", "system", _password_hash("system"), "系统用户", "系统用户"),
        ("user-admin", "admin", _password_hash("admin"), "系统管理员", "系统管理员"),
        ("user-data", "data", _password_hash("data"), "数据管理员", "数据管理员"),
        ("user-basic", "user", _password_hash("user"), "普通用户", "普通评估用户"),
    ]
    for user_id, username, password_hash, role, display_name in users:
        connection.execute(
            """
            INSERT INTO users (user_id, username, password_hash, role, display_name, status)
            VALUES (?, ?, ?, ?, ?, 'active')
            ON CONFLICT(user_id) DO UPDATE SET
              username = excluded.username,
              password_hash = excluded.password_hash,
              role = excluded.role,
              display_name = excluded.display_name,
              status = excluded.status
            """,
            (user_id, username, password_hash, role, display_name),
        )


def _password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:12]


def _normalize_user_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized in {"启用", "enabled"}:
        return "active"
    if normalized in {"停用", "禁用", "disabled", "inactive"}:
        return "disabled"
    return normalized or "active"
