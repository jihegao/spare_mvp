#!/usr/bin/env python3
"""Audit or migrate issue #344 Project exponential failure-rate aliases."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.migrations import (  # noqa: E402
    MIGRATIONS,
    audit_project_failure_distribution_migration,
)
from src.spare_mvp_backend.project_payload import normalize_project_failure_distributions  # noqa: E402


ISSUE_344_MIGRATION_VERSION = 7
ISSUE_344_MIGRATION_NAME = "project_failure_distribution_rate_canonicalization"


def audit_database(database: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    database = database.resolve()
    if not database.exists():
        raise FileNotFoundError(database)
    uri = f"file:{database.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if not quick_check or quick_check[0] != "ok":
            raise RuntimeError(
                f"database quick_check failed: {quick_check[0] if quick_check else 'no result'}"
            )
        report, updates = audit_project_failure_distribution_migration(connection)
        report["database"] = str(database)
        report["quick_check"] = quick_check[0]
        report["migration_state"] = _migration_state(connection)
        report["historical_contexts"] = _audit_historical_contexts(connection)
        historical_issues = sum(
            len(context["issues"])
            for context in report["historical_contexts"]
        )
        report["summary"]["historical_context_issues"] = historical_issues
        return report, updates


def migrate_database(database: Path, *, backup_dir: Path | None = None) -> dict[str, Any]:
    before, updates = audit_database(database)
    if before["summary"]["conflicts"]:
        raise RuntimeError("migration blocked by conflicting or invalid editable Project reliability data")
    _require_issue_344_migration_prerequisites(before["migration_state"])

    backup_path: Path | None = None
    registration_required = not before["migration_state"]["issue_344_applied"]
    if updates or registration_required:
        backup_path = _backup_database(database, backup_dir=backup_dir)
    else:
        return {
            "schema_version": "issue-344-mtbf-database-migration-v1",
            "database": str(database.resolve()),
            "backup": None,
            "before": before,
            "after": before,
        }

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        try:
            current_migration_state = _migration_state(connection)
            _require_issue_344_migration_prerequisites(current_migration_state)
            if current_migration_state["issue_344_applied"] != before["migration_state"]["issue_344_applied"]:
                raise RuntimeError("database migration state changed after audit; rerun --check")
            current_report, current_updates = audit_project_failure_distribution_migration(connection)
            if current_report["summary"]["conflicts"]:
                raise RuntimeError("database changed after audit and now contains migration conflicts")
            if current_updates != updates:
                raise RuntimeError("database changed after audit; rerun --check before --write")
            for project_id, project in current_updates.items():
                connection.execute(
                    "UPDATE projects SET payload_json = ? WHERE project_id = ?",
                    (
                        json.dumps(project, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                        project_id,
                    ),
                )
            final_report, _final_updates = audit_project_failure_distribution_migration(connection)
            if final_report["summary"]["pending"] or final_report["summary"]["conflicts"]:
                raise RuntimeError("Project migration did not reach a canonical state")
            if not current_migration_state["issue_344_applied"]:
                connection.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
                    (ISSUE_344_MIGRATION_VERSION, ISSUE_344_MIGRATION_NAME),
                )
            quick_check = connection.execute("PRAGMA quick_check").fetchone()
            if not quick_check or quick_check[0] != "ok":
                raise RuntimeError(
                    f"post-migration quick_check failed: {quick_check[0] if quick_check else 'no result'}"
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise

    after, _after_updates = audit_database(database)
    if after["summary"]["pending"] or after["summary"]["conflicts"]:
        raise RuntimeError("post-migration audit still reports pending or conflicting Projects")
    return {
        "schema_version": "issue-344-mtbf-database-migration-v1",
        "database": str(database.resolve()),
        "backup": str(backup_path) if backup_path else None,
        "before": before,
        "after": after,
    }


def _migration_state(connection: sqlite3.Connection) -> dict[str, Any]:
    expected = {version: name for version, name, _migrate in MIGRATIONS}
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).fetchone():
        return {
            "applied": {},
            "prerequisite_errors": ["schema_migrations table is missing"],
            "issue_344_applied": False,
        }
    applied = {
        int(version): str(name)
        for version, name in connection.execute(
            "SELECT version, name FROM schema_migrations ORDER BY version"
        )
    }
    prerequisite_errors = []
    for version in range(1, ISSUE_344_MIGRATION_VERSION):
        if applied.get(version) != expected.get(version):
            prerequisite_errors.append(
                f"migration {version} must be {expected.get(version)!r}, found {applied.get(version)!r}"
            )
    recorded_issue_name = applied.get(ISSUE_344_MIGRATION_VERSION)
    if recorded_issue_name not in (None, ISSUE_344_MIGRATION_NAME):
        prerequisite_errors.append(
            f"migration {ISSUE_344_MIGRATION_VERSION} is recorded as {recorded_issue_name!r}"
        )
    return {
        "applied": {str(version): name for version, name in sorted(applied.items())},
        "prerequisite_errors": prerequisite_errors,
        "issue_344_applied": recorded_issue_name == ISSUE_344_MIGRATION_NAME,
    }


def _require_issue_344_migration_prerequisites(state: dict[str, Any]) -> None:
    errors = state.get("prerequisite_errors") or []
    if errors:
        raise RuntimeError(
            "issue #344 migration prerequisites failed: " + "; ".join(str(error) for error in errors)
        )


def _audit_historical_contexts(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    contexts: list[dict[str, Any]] = []
    definitions = (
        ("modeling_snapshots", "snapshot_id", ("project",)),
        ("experiment_plans", "experiment_plan_id", ("config", "projectJson")),
    )
    for table, key_column, project_path in definitions:
        if not connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone():
            continue
        for row_id, payload_json in connection.execute(
            f"SELECT {key_column}, payload_json FROM {table} ORDER BY {key_column}"
        ):
            issues: list[dict[str, Any]] = []
            records: list[dict[str, Any]] = []
            changed = False
            try:
                payload = json.loads(payload_json)
                project = _nested_value(payload, project_path)
                if isinstance(project, dict):
                    _normalized, project_report = normalize_project_failure_distributions(
                        project,
                        strict=False,
                    )
                    issues = project_report["issues"]
                    records = project_report["records"]
                    changed = bool(project_report["changed"])
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                issues = [{
                    "code": "invalid_historical_project_context",
                    "path": ".".join(project_path),
                    "message": str(exc),
                }]
            contexts.append({
                "table": table,
                "record_id": str(row_id),
                "project_path": ".".join(project_path),
                "would_canonicalize": changed,
                "records": records,
                "issues": issues,
                "mutated": False,
            })
    return contexts


def _nested_value(payload: Any, path: tuple[str, ...]) -> Any:
    current = payload
    for field in path:
        if not isinstance(current, dict):
            return None
        current = current.get(field)
    return current


def _backup_database(database: Path, *, backup_dir: Path | None = None) -> Path:
    command = [
        "bash",
        str(REPO_ROOT / "scripts" / "backup-database.sh"),
        "--database",
        str(database.resolve()),
        "--label",
        "issue-344-pre-migration",
    ]
    if backup_dir is not None:
        command.extend(["--backup-dir", str(backup_dir.resolve())])
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    prefix = "Backup written:"
    for line in reversed(result.stdout.splitlines()):
        if line.startswith(prefix):
            backup = Path(line[len(prefix):].strip()).resolve()
            if backup.exists():
                return backup
    raise RuntimeError("database backup command did not report a backup path")


def _write_report(report: dict[str, Any], report_path: Path | None, mode: str) -> Path:
    if report_path is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        report_path = REPO_ROOT / "runs" / "issue-344" / f"mtbf-{mode}-{timestamp}.json"
    report_path = report_path.resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=REPO_ROOT / "runs" / "system-start" / "spare_mvp.sqlite3",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="read-only audit")
    mode.add_argument("--write", action="store_true", help="backup and transactionally migrate")
    parser.add_argument("--report", type=Path, help="JSON report path")
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="backup destination for --write (defaults to runs/database-backups)",
    )
    args = parser.parse_args()

    try:
        if args.write:
            report = migrate_database(args.database, backup_dir=args.backup_dir)
            report_path = _write_report(report, args.report, "write")
            summary = report["after"]["summary"]
            backup = report.get("backup") or "not required"
        else:
            report, _updates = audit_database(args.database)
            _require_issue_344_migration_prerequisites(report["migration_state"])
            report_path = _write_report(report, args.report, "check")
            summary = report["summary"]
            backup = "not created by --check"
    except (FileNotFoundError, RuntimeError, sqlite3.Error, subprocess.CalledProcessError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"database: {args.database.resolve()}")
    print(f"report: {report_path}")
    print(f"backup: {backup}")
    print(
        "summary: "
        f"scanned={summary['scanned']} pending={summary['pending']} "
        f"conflicts={summary['conflicts']} records={summary['records']} "
        f"historical_context_issues={summary.get('historical_context_issues', 0)}"
    )
    return 0 if not summary["conflicts"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
