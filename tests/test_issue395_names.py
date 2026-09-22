from __future__ import annotations

import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from tests.test_backend_api_contract import RecordingAdapter, small_aircraft_support_project


class ExperimentPlanNameAtomicityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.tempdir.name) / "names.sqlite3"
        self.connection = sqlite3.connect(self.database_path)
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)
        self.api = BackendApi(self.repository, RecordingAdapter(), Path(self.tempdir.name))

    def tearDown(self) -> None:
        self.connection.close()
        self.tempdir.cleanup()

    def _save_project(self, project_id: str):
        project = small_aircraft_support_project(project_id)
        self.api.save_project(project)
        return project

    def test_name_is_unicode_trimmed_case_sensitive_and_scoped_to_project(self) -> None:
        first = self._save_project("name-first")
        second = self._save_project("name-second")

        created = self.api.create_experiment_plan(first["project_id"], {"name": "\u3000Alpha\u00a0", "steps": 1})
        case_variant = self.api.create_experiment_plan(first["project_id"], {"name": "alpha", "steps": 1})
        other_project = self.api.create_experiment_plan(second["project_id"], {"name": "Alpha", "steps": 1})

        self.assertEqual(created["config"]["name"], "Alpha")
        self.assertEqual(case_variant["config"]["name"], "alpha")
        self.assertEqual(other_project["config"]["name"], "Alpha")
        with self.assertRaises(BackendApiError) as caught:
            self.api.create_experiment_plan(first["project_id"], {"name": " Alpha ", "steps": 2})
        self.assertEqual(caught.exception.code, "experiment_plan_name_conflict")

    def test_conflict_does_not_create_orphan_snapshot(self) -> None:
        project = self._save_project("name-no-orphan")
        legacy = {
            "experiment_plan_id": "legacy-plan",
            "project_id": project["project_id"],
            "modeling_snapshot_id": None,
            "schema_version": "experiment-plan-v0",
            "project_version": project["project_version"],
            "status": "draft",
            "config": {"name": "existing"},
        }
        self.repository.upsert_experiment_plan(legacy)

        with self.assertRaises(BackendApiError) as caught:
            self.api.create_experiment_plan(project["project_id"], {"name": "existing"})

        self.assertEqual(caught.exception.code, "experiment_plan_name_conflict")
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM modeling_snapshots").fetchone()[0], 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM experiment_plans").fetchone()[0], 1)

    def test_name_uniqueness_is_shared_by_all_users_in_project(self) -> None:
        project = self._save_project("name-all-users")
        self.api.create_experiment_plan(
            project["project_id"], {"name": "shared"}, actor_user_id="user-basic"
        )

        with self.assertRaises(BackendApiError) as caught:
            self.api.create_experiment_plan(
                project["project_id"], {"name": "shared"}, actor_user_id="user-admin"
            )

        self.assertEqual(caught.exception.code, "experiment_plan_name_conflict")

    def test_save_creates_current_snapshot_when_latest_snapshot_is_stale(self) -> None:
        project = self._save_project("name-current-snapshot")
        first = self.api.create_experiment_plan(project["project_id"], {"name": "first"})
        project["projectInfo"]["name"] = "edited current project"
        self.api.save_project(project)

        second = self.api.create_experiment_plan(project["project_id"], {"name": "second"})

        self.assertNotEqual(first["modeling_snapshot_id"], second["modeling_snapshot_id"])
        snapshot = self.repository.get_modeling_snapshot(second["modeling_snapshot_id"])
        self.assertEqual(snapshot["project"]["projectInfo"]["name"], "edited current project")

    def test_failure_after_snapshot_insert_rolls_back_snapshot_and_plan(self) -> None:
        project = self._save_project("name-rollback")
        malformed = {
            "experiment_plan_id": "malformed-plan",
            "project_id": project["project_id"],
            "project_version": project["project_version"],
            "status": "draft",
            "config": {"name": "malformed"},
        }

        with self.assertRaises(ValueError):
            self.repository.save_experiment_plan_atomic(malformed, project_snapshot=project)

        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM modeling_snapshots").fetchone()[0], 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM experiment_plans").fetchone()[0], 0)

    def test_deterministic_id_collision_never_overwrites_existing_plan(self) -> None:
        project = self._save_project("name-id-collision")
        with mock.patch("src.spare_mvp_backend.api._stable_hash", return_value="collision"):
            first = self.api.create_experiment_plan(project["project_id"], {"name": "first", "steps": 1})
            with self.assertRaises(BackendApiError) as caught:
                self.api.create_experiment_plan(project["project_id"], {"name": "second", "steps": 2})

        self.assertEqual(caught.exception.code, "experiment_plan_id_conflict")
        stored = self.repository.get_experiment_plan(first["experiment_plan_id"])
        self.assertEqual(stored["config"]["name"], "first")
        self.assertEqual(stored["config"]["steps"], 1)

    def test_unchanged_legacy_duplicate_can_update_but_rename_to_duplicate_cannot(self) -> None:
        project = self._save_project("name-legacy-duplicates")
        for suffix in ("a", "b"):
            self.repository.upsert_experiment_plan({
                "experiment_plan_id": f"legacy-{suffix}",
                "project_id": project["project_id"],
                "modeling_snapshot_id": None,
                "schema_version": "experiment-plan-v0",
                "project_version": project["project_version"],
                "status": "draft",
                "config": {"name": "duplicate", "steps": 1},
            })

        updated = self.api.update_experiment_plan(project["project_id"], "legacy-a", {"name": " duplicate ", "steps": 9})
        self.assertEqual(updated["config"]["name"], "duplicate")
        self.assertEqual(updated["config"]["steps"], 9)
        other = self.api.create_experiment_plan(project["project_id"], {"name": "other"})
        with self.assertRaises(BackendApiError) as caught:
            self.api.update_experiment_plan(project["project_id"], other["experiment_plan_id"], {"name": "duplicate"})
        self.assertEqual(caught.exception.code, "experiment_plan_name_conflict")
        self.assertEqual(
            self.repository.get_experiment_plan(other["experiment_plan_id"])["config"]["name"],
            "other",
        )

    def test_frozen_plan_remains_immutable(self) -> None:
        project = self._save_project("name-frozen")
        plan = self.api.create_experiment_plan(
            project["project_id"],
            {"name": "frozen", "projectJson": project, "samples": 1},
        )
        self.api.freeze_experiment_plan(project["project_id"], plan["experiment_plan_id"])

        with self.assertRaises(BackendApiError) as caught:
            self.api.update_experiment_plan(project["project_id"], plan["experiment_plan_id"], {"name": "renamed"})

        self.assertEqual(caught.exception.code, "experiment_plan_frozen")
        self.assertEqual(self.repository.get_experiment_plan(plan["experiment_plan_id"])["config"]["name"], "frozen")

    def test_concurrent_creates_allow_only_one_same_project_name(self) -> None:
        project = self._save_project("name-concurrent")
        self.connection.close()
        barrier = threading.Barrier(2)
        outcomes: list[str] = []
        lock = threading.Lock()

        def create() -> None:
            connection = sqlite3.connect(self.database_path, timeout=5)
            api = BackendApi(ContractRepository(connection), RecordingAdapter(), Path(self.tempdir.name))
            barrier.wait()
            try:
                api.create_experiment_plan(project["project_id"], {"name": "race", "steps": 1})
                outcome = "created"
            except BackendApiError as exc:
                outcome = exc.code
            finally:
                connection.close()
            with lock:
                outcomes.append(outcome)

        threads = [threading.Thread(target=create) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.connection = sqlite3.connect(self.database_path)

        self.assertCountEqual(outcomes, ["created", "experiment_plan_name_conflict"])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM experiment_plans").fetchone()[0], 1)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM modeling_snapshots").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
