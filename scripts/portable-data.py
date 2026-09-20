"""Prepare a portable desktop database with SQLite's online backup API."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def database_summary(connection: sqlite3.Connection) -> dict[str, int]:
    tables = [
        row[0]
        for row in connection.execute(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
        )
    ]
    return {name: connection.execute(f"select count(*) from {_quote_identifier(name)}").fetchone()[0] for name in tables}


def checked_summary(connection: sqlite3.Connection, *, label: str) -> dict[str, int]:
    check = connection.execute("pragma quick_check").fetchone()
    if check is None or check[0] != "ok":
        raise ValueError(f"{label} failed SQLite quick_check: {check[0] if check else 'no result'}")
    foreign_key_failures = connection.execute("pragma foreign_key_check").fetchall()
    if foreign_key_failures:
        raise ValueError(f"{label} failed SQLite foreign_key_check: {len(foreign_key_failures)} rows")
    return database_summary(connection)


def _write_status(status_file: Path | None, payload: dict[str, object]) -> None:
    if status_file is None:
        return
    status_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = status_file.with_name(status_file.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, status_file)


def _read_status(status_file: Path | None) -> dict[str, object] | None:
    if status_file is None or not status_file.exists():
        return None
    return json.loads(status_file.read_text(encoding="utf-8-sig"))


def _backup_database(source: Path, destination: Path) -> dict[str, int]:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=destination.name + ".migrating-", suffix=".sqlite3", dir=destination.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as original:
            source_summary = checked_summary(original, label="source")
            with sqlite3.connect(temporary) as migrated:
                original.backup(migrated)
                migrated.commit()
                destination_summary = checked_summary(migrated, label="backup")
        if destination_summary != source_summary:
            raise ValueError("SQLite backup table counts differ from the source database")
        os.link(temporary, destination)
        temporary.unlink()
        return destination_summary
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def prepare_database(
    source: Path,
    destination: Path,
    *,
    allow_existing: bool,
    status_file: Path | None = None,
    recovery_backup_root: Path | None = None,
) -> dict[str, object]:
    source = source.resolve(strict=False)
    destination = destination.resolve(strict=False)
    if destination.exists():
        journal = None
        recoverable = False
        if not allow_existing:
            journal = _read_status(status_file)
            recoverable = (
                isinstance(journal, dict)
                and journal.get("format_version") == 1
                and journal.get("phase") in {"backing-up", "promoted"}
                and journal.get("source") == str(source)
                and journal.get("destination") == str(destination)
            )
            if not recoverable:
                raise FileExistsError(
                    f"Refusing to overwrite or merge existing database {destination}; legacy source remains at {source}"
                )
            with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as original:
                source_summary = checked_summary(original, label="source")
            with sqlite3.connect(f"file:{destination.as_posix()}?mode=ro", uri=True) as existing:
                destination_summary = checked_summary(existing, label="promoted destination")
            if destination_summary != source_summary or journal.get("table_counts") != source_summary:
                raise FileExistsError(
                    f"Migration journal does not prove ownership of existing destination {destination}; both databases were retained"
                )
            allow_existing = True
        with sqlite3.connect(f"file:{destination.as_posix()}?mode=ro", uri=True) as existing:
            summary = checked_summary(existing, label="existing destination")
        recovery_backup = None
        if recoverable and recovery_backup_root is not None:
            recovery_backup_root = recovery_backup_root.resolve(strict=False)
            recovery_backup_root.mkdir(parents=True, exist_ok=True)
            recovery_backup = recovery_backup_root / f"legacy-{journal['migration_id']}.sqlite3"
            if not recovery_backup.exists():
                _backup_database(source, recovery_backup)
        result = {
            "format_version": 1,
            "phase": "complete",
            "action": "recovered-promoted" if not journal is None and recoverable else "reused-existing",
            "source": str(source),
            "destination": str(destination),
            "quick_check": "ok",
            "table_counts": summary,
            "recovery_backup": str(recovery_backup) if recovery_backup else None,
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        _write_status(status_file, result)
        return result
    if not source.is_file():
        raise FileNotFoundError(f"Portable baseline or legacy database is missing: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as original:
        source_summary = checked_summary(original, label="source")
    journal = {
        "format_version": 1,
        "migration_id": uuid.uuid4().hex,
        "phase": "backing-up",
        "source": str(source),
        "destination": str(destination),
        "table_counts": source_summary,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    _write_status(status_file, journal)
    destination_summary = _backup_database(source, destination)
    journal["phase"] = "promoted"
    _write_status(status_file, journal)
    recovery_backup = None
    if recovery_backup_root is not None:
        recovery_backup_root = recovery_backup_root.resolve(strict=False)
        recovery_backup_root.mkdir(parents=True, exist_ok=True)
        recovery_backup = recovery_backup_root / f"legacy-{journal['migration_id']}.sqlite3"
        _backup_database(source, recovery_backup)
    result = {
        **journal,
        "phase": "complete",
        "action": "sqlite-backup",
        "quick_check": "ok",
        "table_counts": destination_summary,
        "recovery_backup": str(recovery_backup) if recovery_backup else None,
        "completed_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    _write_status(status_file, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    migrate = subparsers.add_parser("migrate")
    migrate.add_argument("--source", type=Path, required=True)
    migrate.add_argument("--destination", type=Path, required=True)
    migrate.add_argument("--status-file", type=Path)
    migrate.add_argument("--allow-existing", action="store_true")
    migrate.add_argument("--recovery-backup-root", type=Path)
    args = parser.parse_args()
    if args.command == "migrate":
        result = prepare_database(
            args.source,
            args.destination,
            allow_existing=args.allow_existing,
            status_file=args.status_file,
            recovery_backup_root=args.recovery_backup_root,
        )
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
