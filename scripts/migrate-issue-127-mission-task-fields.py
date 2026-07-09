#!/usr/bin/env python3
"""Migrate saved Project payloads to issue-127 mission task field ownership."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.project_payload import normalize_project_mission_task_field_ownership


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=REPO_ROOT / "runs" / "system-start" / "spare_mvp.sqlite3",
        help="SQLite database containing saved Projects",
    )
    parser.add_argument("--check", action="store_true", help="report Project rows requiring migration")
    parser.add_argument("--write", action="store_true", help="write migrated Project rows after creating a JSON backup")
    args = parser.parse_args()
    if args.check == args.write:
        parser.error("choose exactly one of --check or --write")

    database = args.database.resolve()
    if not database.exists():
        print(f"database does not exist: {database}")
        return 1

    with sqlite3.connect(database) as connection:
        rows = connection.execute("SELECT project_id, payload_json FROM projects ORDER BY project_id").fetchall()
        migrations: list[tuple[str, dict[str, object]]] = []
        for project_id, payload_json in rows:
            payload = json.loads(payload_json)
            migrated = normalize_project_mission_task_field_ownership(payload)
            if migrated != payload:
                migrations.append((str(project_id), migrated))

        stale_imports = _stale_modeling_import_count(connection)
        if args.check:
            _print_report(database, migrations, stale_imports)
            return 1 if migrations else 0

        backup_path = database.with_suffix(database.suffix + ".issue-127-backup.json")
        if backup_path.exists():
            print(f"refusing to overwrite existing backup: {backup_path}")
            return 1
        backup_path.write_text(
            json.dumps(
                {"projects": [{"project_id": project_id, "payload": json.loads(payload_json)} for project_id, payload_json in rows]},
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ) + "\n",
            encoding="utf-8",
        )
        with connection:
            for project_id, payload in migrations:
                connection.execute(
                    "UPDATE projects SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?",
                    (json.dumps(payload, ensure_ascii=False, separators=(",", ":")), project_id),
                )
        _print_report(database, migrations, stale_imports)
        print(f"backup: {backup_path}")
    return 0


def _stale_modeling_import_count(connection: sqlite3.Connection) -> int:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(modeling_imports)")}
    payload_columns = [column for column in ("payload_json", "draft_payload_json", "published_payload_json") if column in columns]
    stale_import_ids: set[str] = set()
    for column in payload_columns:
        for import_id, payload_json in connection.execute(
            f"SELECT import_id, {column} FROM modeling_imports WHERE {column} IS NOT NULL"
        ):
            try:
                payload = json.loads(payload_json)
            except (TypeError, json.JSONDecodeError):
                continue
            if _contains_legacy_task_fields(payload):
                stale_import_ids.add(str(import_id))
    return len(stale_import_ids)


def _contains_legacy_task_fields(value: object) -> bool:
    if isinstance(value, dict):
        if "minRequiredSystems" in value:
            return True
        if "priority" in value and ("basicMissionId" in value or "basicTaskName" in value or "missionId" in value):
            return True
        return any(_contains_legacy_task_fields(child) for child in value.values())
    if isinstance(value, list):
        return any(_contains_legacy_task_fields(item) for item in value)
    return False


def _print_report(database: Path, migrations: list[tuple[str, dict[str, object]]], stale_imports: int) -> None:
    print(f"database: {database}")
    print(f"Projects needing migration: {len(migrations)}")
    for project_id, _ in migrations:
        print(f"- {project_id}")
    print(f"Modeling imports left immutable for versioned republish: {stale_imports}")


if __name__ == "__main__":
    raise SystemExit(main())
