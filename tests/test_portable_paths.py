import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paths_module = load_script("portable-paths.py")
data_module = load_script("portable-data.py")
guard_module = load_script("portable-data-guard.py")


class PortablePathsTest(unittest.TestCase):
    def test_default_paths_separate_persistent_data_and_instance_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install" / "green"
            package.mkdir(parents=True)
            result = paths_module.resolve_paths(str(package), environment={"LOCALAPPDATA": str(root / "local")})
            self.assertEqual(Path(result["data_root"]), (root / "local" / "spare_mvp" / "data").resolve())
            self.assertEqual(Path(result["database"]).parent, Path(result["data_root"]))
            self.assertEqual(Path(result["state_file"]).parent, Path(result["instance_root"]))
            self.assertNotEqual(Path(result["data_root"]), Path(result["instance_root"]))
            self.assertFalse(result["binding_exists"])

    def test_data_root_precedence_and_binding_survives_environment_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install"
            package.mkdir()
            local = root / "local"
            environment = {"LOCALAPPDATA": str(local), "SPARE_MVP_DATA_ROOT": str(root / "from-env")}
            first = paths_module.resolve_paths(str(package), environment=environment, write_binding=True)
            self.assertEqual(Path(first["data_root"]), (root / "from-env").resolve())
            rebound = paths_module.resolve_paths(str(package), environment={"LOCALAPPDATA": str(local)})
            self.assertEqual(Path(rebound["data_root"]), (root / "from-env").resolve())
            explicit = paths_module.resolve_paths(
                str(package), explicit_data_root=str(root / "explicit"), environment=environment
            )
            self.assertEqual(Path(explicit["data_root"]), (root / "explicit").resolve())

    def test_relative_or_overlapping_data_roots_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install"
            package.mkdir()
            with self.assertRaisesRegex(ValueError, "absolute"):
                paths_module.resolve_paths(
                    str(package), environment={"LOCALAPPDATA": str(root / "local"), "SPARE_MVP_DATA_ROOT": "relative"}
                )
            with self.assertRaisesRegex(ValueError, "outside"):
                paths_module.resolve_paths(
                    str(package), explicit_data_root=str(package / "data"), environment={"LOCALAPPDATA": str(root / "local")}
                )
            with self.assertRaisesRegex(ValueError, "too broad|must not overlap"):
                paths_module.resolve_paths(
                    str(package), explicit_data_root=str(root / "local"), environment={"LOCALAPPDATA": str(root / "local")}
                )

    def test_installation_identity_is_stable_for_normalized_path_and_distinct_between_installs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "installs" / "first"
            second = root / "installs" / "second"
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            environment = {"LOCALAPPDATA": str(root / "local")}
            canonical = paths_module.resolve_paths(str(first), environment=environment)
            aliased = paths_module.resolve_paths(str(first.parent / "." / "first"), environment=environment)
            other = paths_module.resolve_paths(str(second), environment=environment)
            self.assertEqual(canonical["installation_id"], aliased["installation_id"])
            self.assertNotEqual(canonical["installation_id"], other["installation_id"])

    def test_corrupt_current_binding_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install"
            package.mkdir()
            environment = {"LOCALAPPDATA": str(root / "local")}
            first = paths_module.resolve_paths(
                str(package), explicit_data_root=str(root / "data"), environment=environment, write_binding=True
            )
            Path(first["binding_file"]).write_text("{}")
            with self.assertRaisesRegex(ValueError, "Invalid portable data binding"):
                paths_module.resolve_paths(str(package), environment=environment)

    def test_corrupt_other_binding_blocks_selection_and_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = {"LOCALAPPDATA": str(root / "local")}
            first_package = root / "first"
            second_package = root / "second"
            first_package.mkdir()
            second_package.mkdir()
            first = paths_module.resolve_paths(
                str(first_package), explicit_data_root=str(root / "shared"),
                environment=environment, write_binding=True
            )
            Path(first["binding_file"]).write_text("{}")
            with self.assertRaisesRegex(ValueError, "Cannot safely inventory"):
                paths_module.resolve_paths(
                    str(second_package), explicit_data_root=str(root / "shared" / "child"),
                    environment=environment, write_binding=True
                )

    def test_other_installation_binding_is_reported_for_delete_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = {"LOCALAPPDATA": str(root / "local")}
            shared = root / "shared"
            first_package = root / "first"
            second_package = root / "second"
            first_package.mkdir()
            second_package.mkdir()
            first = paths_module.resolve_paths(
                str(first_package), explicit_data_root=str(shared), environment=environment, write_binding=True
            )
            second = paths_module.resolve_paths(
                str(second_package), explicit_data_root=str(shared), environment=environment
            )
            self.assertEqual(len(second["other_bindings"]), 1)
            self.assertEqual(second["data_mutex"], first["data_mutex"])

    def test_shared_data_mutex_depends_only_on_normalized_data_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install"
            package.mkdir()
            shared = root / "shared"
            first = paths_module.resolve_paths(
                str(package), explicit_data_root=str(shared), environment={"LOCALAPPDATA": str(root / "session-a")}
            )
            second = paths_module.resolve_paths(
                str(package), explicit_data_root=str(shared), environment={"LOCALAPPDATA": str(root / "session-b")}
            )
            self.assertEqual(first["data_mutex"], second["data_mutex"])
            self.assertTrue(first["data_mutex"].startswith("Global\\"))
            self.assertNotEqual(first["instance_root"], second["instance_root"])

    def test_nested_data_roots_are_rejected_across_installations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = {"LOCALAPPDATA": str(root / "local")}
            first_package = root / "first"
            second_package = root / "second"
            first_package.mkdir()
            second_package.mkdir()
            parent = root / "shared"
            paths_module.resolve_paths(
                str(first_package), explicit_data_root=str(parent), environment=environment, write_binding=True
            )
            with self.assertRaisesRegex(ValueError, "must not be nested"):
                paths_module.resolve_paths(
                    str(second_package), explicit_data_root=str(parent / "child"), environment=environment
                )

            reverse_environment = {"LOCALAPPDATA": str(root / "reverse-local")}
            paths_module.resolve_paths(
                str(first_package), explicit_data_root=str(parent / "child"),
                environment=reverse_environment, write_binding=True
            )
            with self.assertRaisesRegex(ValueError, "must not be nested"):
                paths_module.resolve_paths(
                    str(second_package), explicit_data_root=str(parent), environment=reverse_environment
                )


class PortableDataMigrationTest(unittest.TestCase):
    def create_database(self, path, values):
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as connection:
            connection.execute("create table projects (id integer primary key, name text)")
            connection.executemany("insert into projects(name) values (?)", [(value,) for value in values])

    def test_sqlite_backup_preserves_records_and_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy" / "spare_mvp.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            self.create_database(source, ["one", "two"])
            result = data_module.prepare_database(source, destination, allow_existing=False, status_file=status)
            self.assertEqual(result["action"], "sqlite-backup")
            self.assertTrue(source.is_file())
            with sqlite3.connect(destination) as connection:
                self.assertEqual(connection.execute("select count(*) from projects").fetchone()[0], 2)
                self.assertEqual(connection.execute("pragma quick_check").fetchone()[0], "ok")
            self.assertEqual(json.loads(status.read_text())["table_counts"]["projects"], 2)

    def test_existing_target_is_never_overwritten_without_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "existing.sqlite3"
            self.create_database(source, ["legacy"])
            self.create_database(destination, ["existing", "preserved"])
            with self.assertRaisesRegex(FileExistsError, "Refusing to overwrite"):
                data_module.prepare_database(source, destination, allow_existing=False)
            with sqlite3.connect(destination) as connection:
                self.assertEqual(connection.execute("select count(*) from projects").fetchone()[0], 2)

    def test_existing_bound_target_is_validated_and_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = root / "existing.sqlite3"
            self.create_database(destination, ["existing"])
            result = data_module.prepare_database(root / "retained.sqlite3", destination, allow_existing=True)
            self.assertEqual(result["action"], "reused-existing")
            self.assertEqual(result["table_counts"]["projects"], 1)

    def test_promoted_database_is_recovered_only_with_matching_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            recovery = root / "shared" / "migration-backups"
            self.create_database(source, ["one", "two"])
            destination.parent.mkdir(parents=True)
            self.create_database(destination, ["one", "two"])
            status.parent.mkdir(parents=True)
            status.write_text(json.dumps({
                "format_version": 1,
                "migration_id": "f" * 32,
                "phase": "promoted",
                "source": str(source.resolve()),
                "destination": str(destination.resolve()),
                "table_counts": {"projects": 2},
                "database_sha256": data_module._digest(destination),
            }))
            result = data_module.prepare_database(
                source, destination, allow_existing=False, status_file=status, recovery_backup_root=recovery
            )
            self.assertEqual(result["action"], "recovered-promoted")
            self.assertTrue(Path(result["recovery_backup"]).is_file())

    def test_complete_database_journal_recovers_binding_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            recovery = root / "shared" / "migration-backups"
            self.create_database(source, ["one"])
            first = data_module.prepare_database(
                source, destination, allow_existing=False, status_file=status, recovery_backup_root=recovery
            )
            second = data_module.prepare_database(
                source, destination, allow_existing=False, status_file=status, recovery_backup_root=recovery
            )
            self.assertEqual(first["phase"], "complete")
            self.assertEqual(second["action"], "recovered-promoted")
            self.assertEqual(second["migration_id"], first["migration_id"])

    def test_ready_journal_recovers_crash_after_destination_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            self.create_database(source, ["one"])
            original_write_status = data_module._write_status

            def fail_before_promoted_write(status_path, payload):
                if payload.get("phase") == "promoted":
                    raise RuntimeError("injected crash after destination publish")
                original_write_status(status_path, payload)

            with mock.patch.object(data_module, "_write_status", side_effect=fail_before_promoted_write):
                with self.assertRaisesRegex(RuntimeError, "injected crash"):
                    data_module.prepare_database(
                        source, destination, allow_existing=False, status_file=status
                    )
            self.assertTrue(destination.is_file())
            self.assertEqual(json.loads(status.read_text())["phase"], "ready")
            recovered = data_module.prepare_database(
                source, destination, allow_existing=False, status_file=status
            )
            self.assertEqual(recovered["action"], "recovered-promoted")
            self.assertEqual(recovered["phase"], "complete")

    def test_backing_up_journal_never_adopts_equal_count_different_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            self.create_database(source, ["legacy"])
            self.create_database(destination, ["unrelated"])
            status.parent.mkdir(parents=True)
            status.write_text(json.dumps({
                "format_version": 1,
                "migration_id": "e" * 32,
                "phase": "backing-up",
                "source": str(source.resolve()),
                "destination": str(destination.resolve()),
                "table_counts": {"projects": 1},
                "database_sha256": data_module._digest(destination),
            }))
            with self.assertRaisesRegex(FileExistsError, "Refusing to overwrite"):
                data_module.prepare_database(source, destination, allow_existing=False, status_file=status)
            with sqlite3.connect(destination) as connection:
                self.assertEqual(connection.execute("select name from projects").fetchone()[0], "unrelated")

    def test_sqlite_backup_supports_hash_character_in_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "contains#hash"
            source = root / "legacy" / "spare_mvp.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            self.create_database(source, ["one"])
            result = data_module.prepare_database(source, destination, allow_existing=False)
            self.assertEqual(result["action"], "sqlite-backup")
            with sqlite3.connect(destination) as connection:
                self.assertEqual(connection.execute("select name from projects").fetchone()[0], "one")

    def test_promoted_journal_rejects_same_count_database_with_wrong_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            status = root / "state" / "migration.json"
            self.create_database(source, ["legacy"])
            self.create_database(destination, ["unrelated"])
            status.parent.mkdir(parents=True)
            status.write_text(json.dumps({
                "format_version": 1,
                "migration_id": "d" * 32,
                "phase": "promoted",
                "source": str(source.resolve()),
                "destination": str(destination.resolve()),
                "table_counts": {"projects": 1},
                "database_sha256": "0" * 64,
            }))
            with self.assertRaisesRegex(FileExistsError, "does not prove ownership"):
                data_module.prepare_database(source, destination, allow_existing=False, status_file=status)

    def test_outputs_and_configuration_migrate_while_runtime_state_is_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy"
            destination = root / "shared"
            status = root / "state" / "files.json"
            (legacy / "outputs" / "run-1").mkdir(parents=True)
            (legacy / "outputs" / "run-1" / "result.json").write_text('{"ok": true}')
            (legacy / "user-settings.json").write_text('{"theme": "dark"}')
            (legacy / "logs").mkdir()
            (legacy / "logs" / "backend.log").write_text("runtime only")
            (legacy / "active-ports.json").write_text("runtime only")
            first = data_module.migrate_durable_files(legacy, destination, status_file=status)
            second = data_module.migrate_durable_files(legacy, destination, status_file=status)
            self.assertEqual(first["action"], "migrated-files")
            self.assertEqual(second["action"], "recovered-files")
            self.assertEqual((destination / "outputs" / "run-1" / "result.json").read_text(), '{"ok": true}')
            self.assertEqual((destination / "user-settings.json").read_text(), '{"theme": "dark"}')
            self.assertFalse((destination / "logs").exists())
            self.assertTrue((legacy / "outputs" / "run-1" / "result.json").is_file())

    def test_clean_reinstall_reuses_shared_database_and_outputs_without_file_migration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "package" / "data"
            shared = root / "shared"
            source_database = legacy / "spare_mvp.sqlite3"
            destination_database = shared / "spare_mvp.sqlite3"
            self.create_database(source_database, ["baseline"])
            self.create_database(destination_database, ["retained-user-project"])
            (shared / "outputs").mkdir()
            (shared / "outputs" / "retained.json").write_text("retained")
            status = root / "instance" / "data-migration.json"
            recovery = shared / "migration-backups"

            legacy_has_user_state = bool(data_module.durable_file_manifest(legacy))
            database_result = data_module.prepare_database(
                source_database,
                destination_database,
                allow_existing=not legacy_has_user_state,
                status_file=status,
                recovery_backup_root=recovery,
                preserve_source_before_reuse=True,
            )
            if legacy_has_user_state:
                data_module.migrate_durable_files(legacy, shared, status_file=root / "files.json")

            self.assertFalse(legacy_has_user_state)
            self.assertEqual(database_result["action"], "reused-existing")
            self.assertTrue(Path(database_result["reuse_source_backup"]["path"]).is_file())
            self.assertEqual((shared / "outputs" / "retained.json").read_text(), "retained")
            with sqlite3.connect(destination_database) as connection:
                self.assertEqual(
                    connection.execute("select name from projects").fetchone()[0],
                    "retained-user-project",
                )

    def test_used_legacy_wal_database_is_backed_up_then_blocks_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "package"
            legacy = package / "data"
            shared = root / "shared"
            source_database = legacy / "spare_mvp.sqlite3"
            destination_database = shared / "spare_mvp.sqlite3"
            package.mkdir()
            self.create_database(source_database, ["legacy-main"])
            self.create_database(destination_database, ["shared-user"])
            (legacy / "logs").mkdir()
            (legacy / "logs" / "backend.log").write_text("used")
            environment = {"LOCALAPPDATA": str(root / "local")}
            paths = paths_module.resolve_paths(
                str(package), explicit_data_root=str(shared), environment=environment
            )
            status = Path(paths["instance_root"]) / "data-migration.json"
            recovery = shared / "migration-backups"

            with sqlite3.connect(source_database) as source_connection:
                source_connection.execute("pragma journal_mode=wal")
                source_connection.execute("pragma wal_autocheckpoint=0")
                source_connection.execute("insert into projects(name) values ('legacy-wal')")
                source_connection.commit()
                with self.assertRaisesRegex(FileExistsError, "preserved at"):
                    data_module.prepare_database(
                        source_database,
                        destination_database,
                        allow_existing=True,
                        status_file=status,
                        recovery_backup_root=recovery,
                        preserve_source_before_reuse=True,
                        conflict_after_source_backup=True,
                    )

            journal = json.loads(status.read_text())
            backup_path = Path(journal["reuse_source_backup"]["path"])
            self.assertTrue(backup_path.is_file())
            self.assertEqual(journal["reuse_source_backup"]["backup_sha256"], data_module._digest(backup_path))
            with sqlite3.connect(backup_path) as backup:
                self.assertEqual(
                    [row[0] for row in backup.execute("select name from projects order by id")],
                    ["legacy-main", "legacy-wal"],
                )
            self.assertFalse(Path(paths["binding_file"]).exists())
            with sqlite3.connect(destination_database) as target:
                self.assertEqual(target.execute("select name from projects").fetchone()[0], "shared-user")

    def test_source_backup_failure_prevents_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "package"
            legacy = package / "data"
            shared = root / "shared"
            package.mkdir()
            source_database = legacy / "spare_mvp.sqlite3"
            destination_database = shared / "spare_mvp.sqlite3"
            self.create_database(source_database, ["legacy"])
            self.create_database(destination_database, ["shared"])
            paths = paths_module.resolve_paths(
                str(package), explicit_data_root=str(shared),
                environment={"LOCALAPPDATA": str(root / "local")}
            )
            with mock.patch.object(data_module, "_backup_database", side_effect=RuntimeError("injected backup failure")):
                with self.assertRaisesRegex(RuntimeError, "injected backup failure"):
                    data_module.prepare_database(
                        source_database,
                        destination_database,
                        allow_existing=True,
                        status_file=Path(paths["instance_root"]) / "data-migration.json",
                        recovery_backup_root=shared / "migration-backups",
                        preserve_source_before_reuse=True,
                    )
            self.assertFalse(Path(paths["binding_file"]).exists())

    def test_same_database_snapshot_reuses_without_recovery_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy" / "spare_mvp.sqlite3"
            destination = root / "shared" / "spare_mvp.sqlite3"
            recovery = root / "shared" / "migration-backups"
            status = root / "instance" / "data-migration.json"
            self.create_database(source, ["same"])
            destination.parent.mkdir(parents=True)
            data_module._backup_database(source, destination)
            result = data_module.prepare_database(
                source,
                destination,
                allow_existing=True,
                status_file=status,
                recovery_backup_root=recovery,
                preserve_source_before_reuse=True,
            )
            self.assertEqual(result["action"], "reused-existing")
            self.assertIsNone(result["reuse_source_backup"])
            self.assertEqual(list(recovery.rglob("*.sqlite3")), [])

    def test_legacy_outputs_run_database_then_durable_file_migration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "package" / "data"
            shared = root / "shared"
            source_database = legacy / "spare_mvp.sqlite3"
            destination_database = shared / "spare_mvp.sqlite3"
            self.create_database(source_database, ["legacy-user-project"])
            (legacy / "outputs").mkdir()
            (legacy / "outputs" / "legacy.json").write_text("legacy-output")

            legacy_has_user_state = bool(data_module.durable_file_manifest(legacy))
            database_result = data_module.prepare_database(
                source_database, destination_database, allow_existing=not legacy_has_user_state
            )
            file_result = None
            if legacy_has_user_state:
                file_result = data_module.migrate_durable_files(
                    legacy, shared, status_file=root / "files.json"
                )

            self.assertTrue(legacy_has_user_state)
            self.assertEqual(database_result["action"], "sqlite-backup")
            self.assertEqual(file_result["action"], "migrated-files")
            self.assertEqual((shared / "outputs" / "legacy.json").read_text(), "legacy-output")

    def test_durable_file_migration_resumes_only_its_matching_partial_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy"
            destination = root / "shared"
            status = root / "state" / "files.json"
            (legacy / "outputs").mkdir(parents=True)
            (legacy / "outputs" / "first.json").write_text("first")
            (legacy / "outputs" / "second.json").write_text("second")
            manifest = data_module.durable_file_manifest(legacy)
            (destination / "outputs").mkdir(parents=True)
            (destination / "outputs" / "first.json").write_text("first")
            status.parent.mkdir(parents=True)
            status.write_text(json.dumps({
                "format_version": 1,
                "migration_id": "c" * 32,
                "phase": "promoting",
                "source_root": str(legacy.resolve()),
                "destination_root": str(destination.resolve()),
                "files": manifest,
            }))
            result = data_module.migrate_durable_files(legacy, destination, status_file=status)
            self.assertEqual(result["action"], "recovered-files")
            self.assertEqual((destination / "outputs" / "second.json").read_text(), "second")
            self.assertEqual(result["migration_id"], "c" * 32)

    def test_durable_file_migration_refuses_unjournaled_existing_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy"
            destination = root / "shared"
            (legacy / "outputs").mkdir(parents=True)
            (destination / "outputs").mkdir(parents=True)
            (legacy / "outputs" / "result.json").write_text("legacy")
            (destination / "outputs" / "result.json").write_text("different")
            with self.assertRaisesRegex(FileExistsError, "Refusing to overwrite"):
                data_module.migrate_durable_files(legacy, destination, status_file=root / "state.json")

    def test_durable_file_migration_refuses_target_only_persistent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy"
            destination = root / "shared"
            (legacy / "outputs").mkdir(parents=True)
            (legacy / "outputs" / "new.json").write_text("new")
            destination.mkdir()
            (destination / "user-settings.json").write_text("unrelated")
            with self.assertRaisesRegex(FileExistsError, "target-only files"):
                data_module.migrate_durable_files(legacy, destination, status_file=root / "state.json")
            self.assertFalse((destination / "outputs" / "new.json").exists())

    def test_empty_source_still_refuses_target_only_persistent_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "legacy"
            destination = root / "shared"
            legacy.mkdir()
            destination.mkdir()
            (destination / "unrelated.json").write_text("unrelated")
            with self.assertRaisesRegex(FileExistsError, "target-only files"):
                data_module.migrate_durable_files(legacy, destination, status_file=root / "state.json")


class PortableDataGuardTest(unittest.TestCase):
    def test_backend_options_are_forwarded_instead_of_rejected_by_guard_parser(self):
        args, forwarded = guard_module.parse_arguments([
            "--mutex-name", "Global\\SpareMvpData_test",
            "--module", "src.spare_mvp_backend.http_server",
            "--host", "127.0.0.1", "--port", "4173",
        ])
        self.assertEqual(args.module, "src.spare_mvp_backend.http_server")
        self.assertEqual(forwarded, ["--host", "127.0.0.1", "--port", "4173"])


if __name__ == "__main__":
    unittest.main()
