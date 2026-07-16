#!/usr/bin/env python3
"""Migrate all saved Project contexts to the issue-237 product catalog."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.project_payload import normalize_project_products


migrate_project_products = normalize_project_products

_TABLES = (
    ("projects", "project_id", ()),
    ("modeling_snapshots", "snapshot_id", ("project",)),
    ("experiment_plans", "experiment_plan_id", ("config", "projectJson")),
)


def migrate_database(
    database: Path,
    *,
    write: bool,
    backup_path: Path | None = None,
) -> tuple[dict[str, list[str]], Path | None]:
    database = database.resolve()
    if not database.exists():
        raise FileNotFoundError(database)

    report = {table: [] for table, _key, _path in _TABLES}
    with sqlite3.connect(database) as connection:
        originals: dict[str, list[tuple[str, str]]] = {}
        updates: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for table, key_column, project_path in _TABLES:
            if not _table_exists(connection, table):
                originals[table] = []
                updates[table] = []
                continue
            rows = connection.execute(
                f"SELECT {key_column}, payload_json FROM {table} ORDER BY {key_column}"
            ).fetchall()
            originals[table] = [(str(row_id), str(payload_json)) for row_id, payload_json in rows]
            table_updates: list[tuple[str, dict[str, Any]]] = []
            for row_id, payload_json in rows:
                payload = json.loads(payload_json)
                if not isinstance(payload, dict):
                    raise ValueError(f"{table}.{row_id} payload_json must contain an object")
                migrated = _migrate_nested_project(payload, project_path)
                if migrated != payload:
                    row_key = str(row_id)
                    report[table].append(row_key)
                    table_updates.append((row_key, migrated))
            updates[table] = table_updates

        if not write or not any(report.values()):
            return report, None

        backup = (backup_path or database.with_suffix(database.suffix + ".issue-237-products-backup.json")).resolve()
        if backup.exists():
            raise FileExistsError(f"refusing to overwrite existing backup: {backup}")
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_text(
            json.dumps(
                {
                    "database": str(database),
                    "tables": {
                        table: [
                            {key_column: row_id, "payload": json.loads(payload_json)}
                            for row_id, payload_json in originals[table]
                        ]
                        for table, key_column, _project_path in _TABLES
                    },
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        with connection:
            for table, key_column, _project_path in _TABLES:
                columns = _table_columns(connection, table)
                assignments = "payload_json = ?, updated_at = CURRENT_TIMESTAMP" if "updated_at" in columns else "payload_json = ?"
                for row_id, payload in updates[table]:
                    connection.execute(
                        f"UPDATE {table} SET {assignments} WHERE {key_column} = ?",
                        (json.dumps(payload, ensure_ascii=False, separators=(",", ":")), row_id),
                    )
        return report, backup


def _migrate_nested_project(payload: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    migrated_payload = deepcopy(payload)
    if not path:
        return normalize_project_products(migrated_payload)
    current: Any = migrated_payload
    for field in path[:-1]:
        if not isinstance(current, dict) or not isinstance(current.get(field), dict):
            return migrated_payload
        current = current[field]
    if not isinstance(current, dict) or not isinstance(current.get(path[-1]), dict):
        return migrated_payload
    current[path[-1]] = normalize_project_products(current[path[-1]])
    return migrated_payload


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=REPO_ROOT / "runs" / "system-start" / "spare_mvp.sqlite3",
        help="SQLite database containing saved Project contexts",
    )
    parser.add_argument("--backup", type=Path, help="JSON backup path used by --write")
    parser.add_argument("--check", action="store_true", help="report rows requiring migration")
    parser.add_argument("--write", action="store_true", help="create a JSON backup and update all contexts")
    args = parser.parse_args()
    if args.check == args.write:
        parser.error("choose exactly one of --check or --write")

    try:
        report, backup = migrate_database(args.database, write=args.write, backup_path=args.backup)
    except (FileNotFoundError, FileExistsError, ValueError, json.JSONDecodeError, sqlite3.Error) as exc:
        print(str(exc))
        return 1

    print(f"database: {args.database.resolve()}")
    for table, _key_column, _project_path in _TABLES:
        print(f"{table}: {len(report[table])}")
        for row_id in report[table]:
            print(f"- {row_id}")
    if backup is not None:
        print(f"backup: {backup}")
    if args.check and any(report.values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
