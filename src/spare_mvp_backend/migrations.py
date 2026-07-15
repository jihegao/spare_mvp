"""Versioned compatibility migrations for SQLite databases created by older builds.

``schema.sql`` describes the complete schema required by a new database.  This
module owns only the in-place repairs needed when an existing database was
created before that schema was complete.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable


Migration = tuple[int, str, Callable[[sqlite3.Connection], None]]


def apply_compatibility_migrations(connection: sqlite3.Connection) -> None:
    """Apply each unapplied compatibility migration and record its ownership."""
    applied = {
        int(version): name
        for version, name in connection.execute(
            "SELECT version, name FROM schema_migrations ORDER BY version"
        )
    }
    for version, name, migrate in MIGRATIONS:
        recorded_name = applied.get(version)
        if recorded_name is not None:
            if recorded_name != name:
                raise RuntimeError(
                    f"schema migration {version} is recorded as {recorded_name!r}, expected {name!r}"
                )
            continue
        migrate(connection)
        connection.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
            (version, name),
        )


def _add_column_if_missing(
    connection: sqlite3.Connection,
    *,
    table: str,
    column: str,
    definition: str,
) -> None:
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _migrate_simulation_runs_nullable_scenarios(connection: sqlite3.Connection) -> None:
    columns = {row[1]: row for row in connection.execute("PRAGMA table_info(simulation_runs)")}
    if not any(columns.get(column, (None, None, None, 0))[3] for column in ("scenario_id", "scenario_version")):
        return

    created_by = "created_by" if "created_by" in columns else "NULL"
    lifecycle_status = (
        "COALESCE(NULLIF(lifecycle_status, ''), 'active')"
        if "lifecycle_status" in columns
        else "'active'"
    )
    archived_at = "archived_at" if "archived_at" in columns else "NULL"
    deleted_at = "deleted_at" if "deleted_at" in columns else "NULL"

    foreign_keys_enabled = connection.execute("PRAGMA foreign_keys").fetchone()[0]
    connection.execute("PRAGMA foreign_keys = OFF")
    try:
        connection.executescript(
            f"""
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
              created_by TEXT,
              lifecycle_status TEXT NOT NULL DEFAULT 'active',
              archived_at TEXT,
              deleted_at TEXT,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (project_id) REFERENCES projects(project_id),
              FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
            );

            INSERT INTO simulation_runs_migrated (
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, created_by, lifecycle_status,
              archived_at, deleted_at, payload_json, created_at, updated_at
            )
            SELECT
              run_id, project_id, experiment_plan_id, scenario_id, scenario_version,
              schema_version, model_family, model_id, status, run_type, seed,
              result_summary_id, artifact_manifest_id, {created_by}, {lifecycle_status},
              {archived_at}, {deleted_at}, payload_json, created_at, updated_at
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


def _migrate_simulation_run_lifecycle_columns(connection: sqlite3.Connection) -> None:
    _add_column_if_missing(
        connection,
        table="simulation_runs",
        column="created_by",
        definition="TEXT",
    )
    _add_column_if_missing(
        connection,
        table="simulation_runs",
        column="lifecycle_status",
        definition="TEXT NOT NULL DEFAULT 'active'",
    )
    _add_column_if_missing(
        connection,
        table="simulation_runs",
        column="archived_at",
        definition="TEXT",
    )
    _add_column_if_missing(
        connection,
        table="simulation_runs",
        column="deleted_at",
        definition="TEXT",
    )
    connection.execute(
        """
        UPDATE simulation_runs
        SET lifecycle_status = 'active'
        WHERE lifecycle_status IS NULL OR lifecycle_status = ''
        """
    )


def _migrate_user_authentication_columns(connection: sqlite3.Connection) -> None:
    _add_column_if_missing(connection, table="users", column="password_hash", definition="TEXT")
    _add_column_if_missing(connection, table="users", column="display_name", definition="TEXT")
    _add_column_if_missing(
        connection,
        table="users",
        column="status",
        definition="TEXT NOT NULL DEFAULT 'active'",
    )


def _migrate_experiment_plan_snapshot_column(connection: sqlite3.Connection) -> None:
    _add_column_if_missing(
        connection,
        table="experiment_plans",
        column="modeling_snapshot_id",
        definition="TEXT",
    )


def _migrate_modeling_import_payload_columns(connection: sqlite3.Connection) -> None:
    _add_column_if_missing(
        connection,
        table="modeling_imports",
        column="draft_payload_json",
        definition="TEXT",
    )
    _add_column_if_missing(
        connection,
        table="modeling_imports",
        column="published_payload_json",
        definition="TEXT",
    )


MIGRATIONS: tuple[Migration, ...] = (
    (1, "simulation_runs_nullable_scenarios", _migrate_simulation_runs_nullable_scenarios),
    (2, "simulation_run_lifecycle_columns", _migrate_simulation_run_lifecycle_columns),
    (3, "user_authentication_columns", _migrate_user_authentication_columns),
    (4, "experiment_plan_snapshot_column", _migrate_experiment_plan_snapshot_column),
    (5, "modeling_import_payload_columns", _migrate_modeling_import_payload_columns),
)
