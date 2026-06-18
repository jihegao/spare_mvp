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

    def get_run_chain(self, run_id: str) -> dict[str, str]:
        cursor = self.connection.execute(
            """
            SELECT
              p.project_id,
              p.project_version,
              p.schema_version AS project_schema_version,
              s.scenario_id,
              s.scenario_version,
              s.schema_version AS scenario_schema_version,
              r.run_id,
              r.schema_version AS run_schema_version,
              r.result_summary_id AS referenced_result_summary_id,
              r.artifact_manifest_id AS referenced_artifact_manifest_id,
              rs.result_summary_id,
              rs.schema_version AS result_schema_version,
              am.artifact_manifest_id,
              am.schema_version AS artifact_manifest_schema_version
            FROM simulation_runs r
            JOIN projects p ON p.project_id = r.project_id
            JOIN scenarios s ON s.scenario_id = r.scenario_id
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
        if chain["referenced_result_summary_id"] and chain["result_summary_id"] is None:
            raise ValueError(f"identity chain mismatch for result summary on run {run_id}")
        if chain["referenced_artifact_manifest_id"] and chain["artifact_manifest_id"] is None:
            raise ValueError(f"identity chain mismatch for artifact manifest on run {run_id}")
        del chain["referenced_result_summary_id"]
        del chain["referenced_artifact_manifest_id"]
        return chain


def _required(payload: dict[str, Any], field: str) -> Any:
    value = payload.get(field)
    if value is None:
        raise ValueError(f"missing required field {field!r}")
    return value


def _to_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _row_to_dict(cursor: sqlite3.Cursor, row: sqlite3.Row | tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description or [])}
