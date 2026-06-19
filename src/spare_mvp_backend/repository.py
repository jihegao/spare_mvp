"""SQLite repository helpers for application contract persistence."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def initialize_database(connection: sqlite3.Connection) -> None:
    """Create the PR-D persistence schema in an existing SQLite connection."""
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _ensure_column(connection, "experiment_plans", "modeling_snapshot_id", "TEXT")
    connection.commit()


class ContractRepository:
    """Persist contract objects without interpreting Mesa simulation semantics."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

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
        self.connection.execute(
            """
            INSERT INTO simulation_runs (
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                _required(run, "run_id"),
                _required(run, "project_id"),
                run.get("experiment_plan_id"),
                _required(run, "scenario_id"),
                _required(run, "scenario_version"),
                _required(run, "schema_version"),
                _required(run, "model_family"),
                _required(run, "model_id"),
                _required(run, "status"),
                run.get("run_type"),
                run.get("seed"),
                run.get("result_summary_id"),
                _required(run, "artifact_manifest_id"),
                _to_json(run),
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

    def get_run_chain(self, run_id: str) -> dict[str, str]:
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
            JOIN scenarios s ON s.scenario_id = r.scenario_id
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


def _required(payload: dict[str, Any], field: str) -> Any:
    value = payload.get(field)
    if value is None:
        raise ValueError(f"missing required field {field!r}")
    return value


def _to_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _row_to_dict(cursor: sqlite3.Cursor, row: sqlite3.Row | tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description or [])}


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
