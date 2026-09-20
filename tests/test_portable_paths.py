import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paths_module = load_script("portable-paths.py")
data_module = load_script("portable-data.py")


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

    def test_other_installation_binding_is_reported_for_delete_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = {"LOCALAPPDATA": str(root / "local")}
            shared = root / "shared"
            first_package = root / "first"
            second_package = root / "second"
            first_package.mkdir()
            second_package.mkdir()
            paths_module.resolve_paths(
                str(first_package), explicit_data_root=str(shared), environment=environment, write_binding=True
            )
            second = paths_module.resolve_paths(
                str(second_package), explicit_data_root=str(shared), environment=environment
            )
            self.assertEqual(len(second["other_bindings"]), 1)


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
            }))
            result = data_module.prepare_database(
                source, destination, allow_existing=False, status_file=status, recovery_backup_root=recovery
            )
            self.assertEqual(result["action"], "recovered-promoted")
            self.assertTrue(Path(result["recovery_backup"]).is_file())


if __name__ == "__main__":
    unittest.main()
