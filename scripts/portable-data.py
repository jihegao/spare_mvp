"""Prepare a portable desktop database with SQLite's online backup API."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


EPHEMERAL_LEGACY_ENTRIES = {
    "active-ports.json",
    "integrity-cache.json",
    "pids",
    "logs",
    "matplotlib",
    "diagnostics",
}
DATABASE_ENTRIES = {"spare_mvp.sqlite3", "spare_mvp.sqlite3-wal", "spare_mvp.sqlite3-shm"}


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def _sqlite_read_only_uri(path: Path) -> str:
    return path.resolve(strict=False).as_uri() + "?mode=ro"


def durable_file_manifest(root: Path, *, additional_excluded_entries: frozenset[str] = frozenset()) -> dict[str, str]:
    if not root.exists():
        return {}
    result: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if (
            relative.parts[0] in EPHEMERAL_LEGACY_ENTRIES
            or relative.parts[0] in additional_excluded_entries
            or relative.as_posix() in DATABASE_ENTRIES
        ):
            continue
        if path.is_symlink():
            raise ValueError(f"Legacy persistent data contains a symbolic link: {path}")
        if path.is_file():
            result[relative.as_posix()] = _digest(path)
    return result


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


def _backup_database(source: Path, destination: Path, *, on_ready=None) -> tuple[dict[str, int], str]:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=destination.name + ".migrating-", suffix=".sqlite3", dir=destination.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(_sqlite_read_only_uri(source), uri=True) as original:
            source_summary = checked_summary(original, label="source")
            with sqlite3.connect(temporary) as migrated:
                original.backup(migrated)
                migrated.commit()
                destination_summary = checked_summary(migrated, label="backup")
        if destination_summary != source_summary:
            raise ValueError("SQLite backup table counts differ from the source database")
        database_sha256 = _digest(temporary)
        if on_ready is not None:
            # Persist the exact content proof before publishing the destination.
            # If the process dies after os.link(), the ready journal can safely
            # identify and recover only this prepared backup.
            on_ready(destination_summary, database_sha256)
        os.link(temporary, destination)
        temporary.unlink()
        return destination_summary, database_sha256
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
                and journal.get("phase") in {"ready", "promoted", "complete"}
                and journal.get("source") == str(source)
                and journal.get("destination") == str(destination)
                and isinstance(journal.get("migration_id"), str)
                and isinstance(journal.get("database_sha256"), str)
            )
            if not recoverable:
                raise FileExistsError(
                    f"Refusing to overwrite or merge existing database {destination}; legacy source remains at {source}"
                )
            with sqlite3.connect(_sqlite_read_only_uri(source), uri=True) as original:
                source_summary = checked_summary(original, label="source")
            with sqlite3.connect(_sqlite_read_only_uri(destination), uri=True) as existing:
                destination_summary = checked_summary(existing, label="promoted destination")
            if (
                destination_summary != source_summary
                or journal.get("table_counts") != source_summary
                or journal.get("database_sha256") != _digest(destination)
            ):
                raise FileExistsError(
                    f"Migration journal does not prove ownership of existing destination {destination}; both databases were retained"
                )
            allow_existing = True
        with sqlite3.connect(_sqlite_read_only_uri(destination), uri=True) as existing:
            summary = checked_summary(existing, label="existing destination")
        recovery_backup = None
        if recoverable and recovery_backup_root is not None:
            recovery_backup_root = recovery_backup_root.resolve(strict=False)
            recovery_backup_root.mkdir(parents=True, exist_ok=True)
            recovery_backup = recovery_backup_root / f"legacy-{journal['migration_id']}.sqlite3"
            if not recovery_backup.exists():
                _backup_database(source, recovery_backup)
        result = {
            **(journal if isinstance(journal, dict) else {}),
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
    with sqlite3.connect(_sqlite_read_only_uri(source), uri=True) as original:
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
    def record_ready(destination_summary: dict[str, int], database_sha256: str) -> None:
        journal["phase"] = "ready"
        journal["table_counts"] = destination_summary
        journal["database_sha256"] = database_sha256
        _write_status(status_file, journal)

    destination_summary, database_sha256 = _backup_database(source, destination, on_ready=record_ready)
    journal["phase"] = "promoted"
    journal["database_sha256"] = database_sha256
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


def migrate_durable_files(source_root: Path, destination_root: Path, *, status_file: Path) -> dict[str, object]:
    source_root = source_root.resolve(strict=False)
    destination_root = destination_root.resolve(strict=False)
    manifest = durable_file_manifest(source_root)
    if not manifest:
        return {
            "format_version": 1,
            "phase": "complete",
            "action": "no-durable-files",
            "source_root": str(source_root),
            "destination_root": str(destination_root),
            "files": {},
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        }
    existing_journal = _read_status(status_file)
    journal_owned = (
        isinstance(existing_journal, dict)
        and existing_journal.get("format_version") == 1
        and existing_journal.get("phase") in {"promoting", "complete"}
        and existing_journal.get("source_root") == str(source_root)
        and existing_journal.get("destination_root") == str(destination_root)
        and existing_journal.get("files") == manifest
    )
    target_manifest = durable_file_manifest(
        destination_root, additional_excluded_entries=frozenset({"migration-backups"})
    )
    unexpected_target_files = sorted(set(target_manifest) - set(manifest))
    if unexpected_target_files:
        raise FileExistsError(
            "Refusing to merge persistent data with target-only files: "
            + ", ".join(unexpected_target_files)
        )
    existing_files = []
    for relative, expected in manifest.items():
        target = destination_root / Path(relative)
        if not target.exists():
            continue
        if not target.is_file() or target.is_symlink() or _digest(target) != expected:
            raise FileExistsError(f"Refusing to overwrite different persistent data: {target}")
        existing_files.append(relative)
    if existing_files and not journal_owned:
        raise FileExistsError(
            f"Persistent data already exists without a matching migration journal: {destination_root}"
        )

    journal = existing_journal if journal_owned else {
        "format_version": 1,
        "migration_id": uuid.uuid4().hex,
        "phase": "promoting",
        "source_root": str(source_root),
        "destination_root": str(destination_root),
        "files": manifest,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    _write_status(status_file, journal)
    destination_root.mkdir(parents=True, exist_ok=True)
    for relative, expected in manifest.items():
        source = source_root / Path(relative)
        target = destination_root / Path(relative)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=target.name + ".migrating-", dir=target.parent)
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            shutil.copyfile(source, temporary)
            if _digest(temporary) != expected:
                raise ValueError(f"Persistent data copy verification failed: {source}")
            os.link(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    destination_manifest = {
        relative: _digest(destination_root / Path(relative)) for relative in manifest
    }
    if destination_manifest != manifest:
        raise ValueError("Migrated persistent data differs from the legacy source")
    result = {
        **journal,
        "phase": "complete",
        "action": "recovered-files" if journal_owned else "migrated-files",
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
    migrate_files = subparsers.add_parser("migrate-files")
    migrate_files.add_argument("--source-root", type=Path, required=True)
    migrate_files.add_argument("--destination-root", type=Path, required=True)
    migrate_files.add_argument("--status-file", type=Path, required=True)
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
    elif args.command == "migrate-files":
        result = migrate_durable_files(args.source_root, args.destination_root, status_file=args.status_file)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
