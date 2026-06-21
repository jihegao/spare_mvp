from __future__ import annotations

import json
import sqlite3
from pathlib import Path
import unittest

from src.spare_mvp_backend.repository import ContractRepository, initialize_database


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "src" / "spare_mvp_backend" / "schema.sql"


class DatabaseContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)

    def tearDown(self) -> None:
        self.connection.close()

    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def _persist_complete_smoke_chain(self) -> None:
        project = self._fixture("smoke_project.json")
        run = self._fixture("smoke_run.json")
        result = self._fixture("smoke_result.json")
        manifest = self._fixture("smoke_artifact_manifest.json")
        scenario = self._fixture("smoke_scenario.json")
        snapshot = {
            "snapshot_id": "modeling-snapshot-project-smoke-contract-001",
            "project_id": project["project_id"],
            "schema_version": "modeling-snapshot-v0",
            "project_version": project["project_version"],
            "project": project,
        }
        plan = {
            "experiment_plan_id": "experiment-plan-project-smoke-contract-001",
            "project_id": project["project_id"],
            "modeling_snapshot_id": snapshot["snapshot_id"],
            "schema_version": "experiment-plan-v0",
            "project_version": project["project_version"],
            "status": "draft",
            "config": {"name": "contract smoke", "steps": 3},
        }
        run = {
            **run,
            "experiment_plan_id": plan["experiment_plan_id"],
            "modeling_snapshot_id": snapshot["snapshot_id"],
            "lifecycle_status": "active",
            "created_by": "system",
        }
        self.repository.upsert_project(project)
        self.repository.upsert_modeling_snapshot(snapshot)
        self.repository.upsert_experiment_plan(plan)
        self.repository.upsert_scenario(scenario)
        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(result)
        self.repository.upsert_artifact_manifest(manifest)

    def test_schema_declares_required_persistence_tables(self) -> None:
        self.assertTrue(SCHEMA_PATH.exists())
        tables = {
            row[0]
            for row in self.connection.execute(
                "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
            )
        }

        self.assertEqual(
            tables,
            {
                "projects",
                "users",
                "sessions",
                "project_access",
                "audit_events",
                "modeling_imports",
                "experiment_plans",
                "modeling_snapshots",
                "scenarios",
                "simulation_runs",
                "result_summaries",
                "artifact_manifests",
            },
        )

    def test_schema_preserves_version_and_traceability_columns(self) -> None:
        required_columns = {
            "users": {"user_id", "username", "password_hash", "role", "display_name", "status"},
            "sessions": {"session_token", "user_id", "created_at", "expires_at"},
            "project_access": {"user_id", "project_id", "access_role"},
            "audit_events": {
                "audit_event_id",
                "actor_user_id",
                "action",
                "resource_type",
                "resource_id",
                "outcome",
                "details_json",
            },
            "projects": {"project_id", "schema_version", "project_version", "payload_json"},
            "modeling_snapshots": {
                "snapshot_id",
                "project_id",
                "schema_version",
                "project_version",
                "payload_json",
            },
            "scenarios": {
                "scenario_id",
                "project_id",
                "schema_version",
                "scenario_version",
                "simulation_model_family",
                "simulation_model_id",
                "payload_json",
            },
            "simulation_runs": {
                "run_id",
                "project_id",
                "scenario_id",
                "scenario_version",
                "model_family",
                "model_id",
                "status",
                "result_summary_id",
                "artifact_manifest_id",
                "payload_json",
                "created_by",
                "lifecycle_status",
                "archived_at",
                "deleted_at",
            },
            "artifact_manifests": {
                "artifact_manifest_id",
                "run_id",
                "scenario_id",
                "scenario_version",
                "schema_version",
                "payload_json",
            },
            "modeling_imports": {
                "import_id",
                "project_id",
                "schema_version",
                "import_version",
                "status",
                "validation_status",
                "referenced_run_ids_json",
                "payload_json",
                "draft_payload_json",
                "published_payload_json",
            },
        }

        for table, columns in required_columns.items():
            with self.subTest(table=table):
                actual = {row[1] for row in self.connection.execute(f"pragma table_info({table})")}
                self.assertLessEqual(columns, actual)

    def test_repository_persists_contract_identity_chain(self) -> None:
        project = self._fixture("smoke_project.json")
        scenario = self._fixture("smoke_scenario.json")
        run = self._fixture("smoke_run.json")
        result = self._fixture("smoke_result.json")
        manifest = self._fixture("smoke_artifact_manifest.json")

        self.repository.upsert_project(project)
        self.repository.upsert_scenario(scenario)
        self.repository.upsert_run(run)
        self.repository.upsert_result_summary(result)
        self.repository.upsert_artifact_manifest(manifest)

        chain = self.repository.get_run_chain("run-smoke-contract-001")

        self.assertEqual(
            chain,
            {
                "project_id": "project-smoke-contract-001",
                "project_version": "project-v0.1",
                "project_schema_version": "project-v0",
                "experiment_plan_id": "experiment-plan-smoke-001",
                "scenario_id": "scenario-smoke-contract-001",
                "scenario_version": "scenario-v0.1",
                "scenario_schema_version": "scenario-v0",
                "run_id": "run-smoke-contract-001",
                "run_schema_version": "run-v0",
                "result_summary_id": "result-smoke-contract-001",
                "result_schema_version": "result-v0",
                "artifact_manifest_id": "artifact-manifest-smoke-contract-001",
                "artifact_manifest_schema_version": "artifact-manifest-v0",
            },
        )

    def test_repository_lists_runs_and_hides_soft_deleted_by_default(self) -> None:
        project = self._fixture("smoke_project.json")
        scenario = self._fixture("smoke_scenario.json")
        run = self._fixture("smoke_run.json")
        manifest = self._fixture("smoke_artifact_manifest.json")
        self.repository.upsert_project(project)
        self.repository.upsert_scenario(scenario)
        self.repository.upsert_run({**run, "lifecycle_status": "active", "created_by": "system"})
        self.repository.upsert_artifact_manifest(manifest)

        listed = self.repository.list_runs()
        self.assertEqual([item["run_id"] for item in listed], [run["run_id"]])
        self.assertEqual(listed[0]["created_by"], "system")
        self.assertEqual(listed[0]["lifecycle_status"], "active")
        self.assertEqual(listed[0]["artifact_count"], len(manifest["artifacts"]))

        deleted = self.repository.soft_delete_run(run["run_id"], deleted_by="system")

        self.assertEqual(deleted["lifecycle_status"], "deleted")
        self.assertTrue(deleted["deleted_at"])
        self.assertEqual(deleted["deleted_by"], "system")
        self.assertEqual(self.repository.list_runs(), [])
        self.assertEqual([item["run_id"] for item in self.repository.list_runs(include_deleted=True)], [run["run_id"]])

    def test_upsert_run_preserves_existing_lifecycle_when_stale_status_refresh_replays_active(self) -> None:
        project = self._fixture("smoke_project.json")
        scenario = self._fixture("smoke_scenario.json")
        run = self._fixture("smoke_run.json")
        self.repository.upsert_project(project)
        self.repository.upsert_scenario(scenario)
        self.repository.upsert_run({**run, "lifecycle_status": "active", "created_by": "system"})

        deleted = self.repository.soft_delete_run(run["run_id"], deleted_by="system")
        self.assertEqual(deleted["lifecycle_status"], "deleted")

        stale_status_refresh = {
            **run,
            "status": "running",
            "lifecycle_status": "active",
            "deleted_at": None,
            "deleted_by": None,
        }
        self.repository.upsert_run(stale_status_refresh)

        stored = self.repository.get_run(run["run_id"])
        self.assertEqual(stored["status"], "running")
        self.assertEqual(stored["lifecycle_status"], "deleted")
        self.assertEqual(stored["deleted_by"], "system")
        self.assertTrue(stored["deleted_at"])
        self.assertEqual(self.repository.list_runs(), [])

    def test_repository_get_run_detail_combines_chain_result_and_artifacts(self) -> None:
        self._persist_complete_smoke_chain()
        detail = self.repository.get_run_detail("run-smoke-contract-001")

        self.assertEqual(detail["run"]["run_id"], "run-smoke-contract-001")
        self.assertEqual(detail["chain"]["run_id"], "run-smoke-contract-001")
        self.assertEqual(detail["result_summary"]["run_id"], "run-smoke-contract-001")
        self.assertEqual(detail["artifact_manifest"]["run_id"], "run-smoke-contract-001")

    def test_initialize_database_migrates_existing_experiment_plan_table(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(
                """
                CREATE TABLE experiment_plans (
                  experiment_plan_id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  schema_version TEXT NOT NULL,
                  project_version TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'draft',
                  payload_json TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            initialize_database(connection)
            columns = {row[1] for row in connection.execute("pragma table_info(experiment_plans)")}
            self.assertIn("modeling_snapshot_id", columns)
        finally:
            connection.close()

    def test_initialize_database_relaxes_legacy_simulation_run_scenario_constraints(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(
                """
                CREATE TABLE projects (
                  project_id TEXT PRIMARY KEY
                );

                CREATE TABLE scenarios (
                  scenario_id TEXT PRIMARY KEY
                );

                CREATE TABLE simulation_runs (
                  run_id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  experiment_plan_id TEXT,
                  scenario_id TEXT NOT NULL,
                  scenario_version TEXT NOT NULL,
                  schema_version TEXT NOT NULL,
                  model_family TEXT NOT NULL,
                  model_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  run_type TEXT,
                  seed INTEGER,
                  result_summary_id TEXT,
                  artifact_manifest_id TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                INSERT INTO projects (project_id) VALUES ('project-legacy');
                INSERT INTO scenarios (scenario_id) VALUES ('scenario-legacy');
                INSERT INTO simulation_runs (
                  run_id, project_id, scenario_id, scenario_version, schema_version,
                  model_family, model_id, status, artifact_manifest_id, payload_json
                )
                VALUES (
                  'run-legacy', 'project-legacy', 'scenario-legacy', 'scenario-v0.1',
                  'run-v0', 'mesa', 'aviation-support', 'completed',
                  'artifact-legacy', '{"run_id": "run-legacy"}'
                );
                """
            )

            initialize_database(connection)

            columns = {
                row[1]: {"notnull": row[3]}
                for row in connection.execute("pragma table_info(simulation_runs)")
            }
            self.assertEqual(columns["scenario_id"]["notnull"], 0)
            self.assertEqual(columns["scenario_version"]["notnull"], 0)
            self.assertEqual(
                connection.execute("SELECT scenario_id, scenario_version FROM simulation_runs WHERE run_id = 'run-legacy'").fetchone(),
                ("scenario-legacy", "scenario-v0.1"),
            )
        finally:
            connection.close()

    def test_failed_simulation_run_constraint_migration_restores_foreign_keys(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript(
                """
                CREATE TABLE projects (
                  project_id TEXT PRIMARY KEY
                );

                CREATE TABLE scenarios (
                  scenario_id TEXT PRIMARY KEY
                );

                CREATE TABLE simulation_runs (
                  run_id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  scenario_id TEXT NOT NULL,
                  scenario_version TEXT NOT NULL,
                  schema_version TEXT NOT NULL,
                  model_family TEXT NOT NULL,
                  model_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  artifact_manifest_id TEXT NOT NULL
                );

                INSERT INTO projects (project_id) VALUES ('project-legacy');
                INSERT INTO scenarios (scenario_id) VALUES ('scenario-legacy');
                INSERT INTO simulation_runs (
                  run_id, project_id, scenario_id, scenario_version, schema_version,
                  model_family, model_id, status, artifact_manifest_id
                )
                VALUES (
                  'run-legacy', 'project-legacy', 'scenario-legacy', 'scenario-v0.1',
                  'run-v0', 'mesa', 'aviation-support', 'completed', 'artifact-legacy'
                );
                """
            )

            with self.assertRaises(sqlite3.OperationalError):
                initialize_database(connection)

            self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        finally:
            connection.close()

    def test_repository_seeds_m4_users_and_persists_audit_events(self) -> None:
        data_user = self.repository.get_user_by_username("data")
        session = self.repository.create_session(data_user["user_id"])
        event = self.repository.insert_audit_event(
            actor_user_id=data_user["user_id"],
            action="modeling_import.save",
            resource_type="modeling_import",
            resource_id="import-carrier-day-night-001",
            outcome="allowed",
            details={"project_id": "project-carrier-day-night"},
        )

        self.assertEqual(data_user["role"], "数据管理员")
        self.assertEqual(self.repository.get_session_user(session["token"])["user_id"], data_user["user_id"])
        self.assertEqual(event["actor_user_id"], data_user["user_id"])
        self.assertEqual(
            self.repository.list_audit_events(resource_id="import-carrier-day-night-001")[0]["details"],
            {"project_id": "project-carrier-day-night"},
        )

    def test_repository_persists_modeling_import_package_and_publish_state(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        validation = {"ok": True, "status": "valid", "issues": []}

        self.repository.upsert_modeling_import(import_package, validation)
        stored = self.repository.get_modeling_import(import_package["importId"])

        self.assertEqual(stored["draftPackage"]["importId"], import_package["importId"])
        self.assertEqual(stored["draftPackage"]["projectId"], import_package["projectId"])
        self.assertEqual(stored["validation"], validation)
        self.assertEqual(stored["lifecycle"]["state"], "draft")
        self.assertIsNone(stored["publishedPackage"])

        published = self.repository.publish_modeling_import(import_package["importId"])

        self.assertEqual(published["draftPackage"]["lifecycle"]["state"], "published")
        self.assertEqual(published["publishedPackage"]["lifecycle"]["state"], "published")
        self.assertEqual(published["validation"], validation)
        self.assertEqual(
            self.repository.get_modeling_import(import_package["importId"])["publishedPackage"]["lifecycle"]["state"],
            "published",
        )

    def test_repository_keeps_published_snapshot_after_new_draft_and_reopen(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        validation = {"ok": True, "status": "valid", "issues": []}
        original_quantity = import_package["objects"]["equipmentAssets"][1]["quantity"]
        changed_quantity = original_quantity + 1

        with self.subTest("red path: publish then save a changed draft"):
            self.repository.upsert_modeling_import(import_package, validation)
            self.repository.publish_modeling_import(import_package["importId"])

            changed_package = self._fixture("modeling_import_project.json")
            changed_package["lifecycle"] = {
                "state": "draft",
                "version": 2,
                "referencedRunIds": [],
            }
            changed_package["objects"]["equipmentAssets"][1]["quantity"] = changed_quantity
            self.repository.upsert_modeling_import(changed_package, validation)

            stored = self.repository.get_modeling_import(import_package["importId"])
            self.assertEqual(stored["draftPackage"]["lifecycle"]["state"], "draft")
            self.assertEqual(stored["draftPackage"]["lifecycle"]["version"], 2)
            self.assertEqual(stored["draftPackage"]["objects"]["equipmentAssets"][1]["quantity"], changed_quantity)
            self.assertEqual(stored["publishedPackage"]["lifecycle"]["state"], "published")
            self.assertEqual(stored["publishedPackage"]["lifecycle"]["version"], 1)
            self.assertEqual(stored["publishedPackage"]["objects"]["equipmentAssets"][1]["quantity"], original_quantity)

    def test_repository_reopens_modeling_import_draft_and_published_payloads(self) -> None:
        import tempfile

        validation = {"ok": True, "status": "valid", "issues": []}
        with tempfile.TemporaryDirectory() as tempdir:
            database_path = Path(tempdir) / "spare-mvp.sqlite"
            connection = sqlite3.connect(database_path)
            try:
                initialize_database(connection)
                repository = ContractRepository(connection)
                import_package = self._fixture("modeling_import_project.json")
                original_quantity = import_package["objects"]["equipmentAssets"][1]["quantity"]
                changed_quantity = original_quantity + 1
                repository.upsert_modeling_import(import_package, validation)
                repository.publish_modeling_import(import_package["importId"])
                changed_package = self._fixture("modeling_import_project.json")
                changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
                changed_package["objects"]["equipmentAssets"][1]["quantity"] = changed_quantity
                repository.upsert_modeling_import(changed_package, validation)
            finally:
                connection.close()

            reopened = sqlite3.connect(database_path)
            try:
                initialize_database(reopened)
                stored = ContractRepository(reopened).get_modeling_import("import-carrier-day-night-001")
            finally:
                reopened.close()

        self.assertEqual(stored["draftPackage"]["objects"]["equipmentAssets"][1]["quantity"], changed_quantity)
        self.assertEqual(stored["publishedPackage"]["objects"]["equipmentAssets"][1]["quantity"], original_quantity)

    def test_repository_blocks_publishing_referenced_modeling_import_without_new_version(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["lifecycle"] = {
            "state": "published",
            "version": 1,
            "referencedRunIds": ["run-smoke-contract-001"],
        }
        validation = {"ok": True, "status": "valid", "issues": []}

        self.repository.upsert_modeling_import(import_package, validation)

        with self.assertRaisesRegex(ValueError, "published modeling import is referenced"):
            self.repository.assert_modeling_import_can_publish(import_package["importId"])

    def test_repository_blocks_overwriting_referenced_published_modeling_import_on_publish(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        validation = {"ok": True, "status": "valid", "issues": []}
        original_mission_name = import_package["objects"]["missionProfiles"][0]["name"]
        self.repository.upsert_modeling_import(import_package, validation)
        self.repository.publish_modeling_import(import_package["importId"])
        self.connection.execute(
            """
            UPDATE modeling_imports
            SET referenced_run_ids_json = ?
            WHERE import_id = ?
            """,
            (
                json.dumps(["run-smoke-contract-001"]),
                import_package["importId"],
            ),
        )
        self.connection.commit()

        changed_package = self._fixture("modeling_import_project.json")
        changed_package["lifecycle"] = {
            "state": "draft",
            "version": 2,
            "referencedRunIds": [],
        }
        changed_package["objects"]["missionProfiles"][0]["name"] = "changed silently"
        self.repository.upsert_modeling_import(changed_package, validation)

        with self.assertRaisesRegex(ValueError, "published modeling import is referenced"):
            self.repository.publish_modeling_import(changed_package["importId"])

    def test_repository_blocks_direct_published_upsert_over_referenced_published_import(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        validation = {"ok": True, "status": "valid", "issues": []}
        original_mission_name = import_package["objects"]["missionProfiles"][0]["name"]
        self.repository.upsert_modeling_import(import_package, validation)
        self.repository.publish_modeling_import(import_package["importId"])
        self.connection.execute(
            """
            UPDATE modeling_imports
            SET referenced_run_ids_json = ?
            WHERE import_id = ?
            """,
            (
                json.dumps(["run-smoke-contract-001"]),
                import_package["importId"],
            ),
        )
        self.connection.commit()

        changed_package = self._fixture("modeling_import_project.json")
        changed_package["lifecycle"] = {
            "state": "published",
            "version": 2,
            "referencedRunIds": [],
        }
        changed_package["objects"]["missionProfiles"][0]["name"] = "changed through direct save"

        with self.assertRaisesRegex(ValueError, "published modeling import is referenced"):
            self.repository.upsert_modeling_import(changed_package, validation)

        stored = self.repository.get_modeling_import(import_package["importId"])
        self.assertEqual(stored["publishedPackage"]["objects"]["missionProfiles"][0]["name"], original_mission_name)
        row = self.repository._get_modeling_import_row(import_package["importId"])
        self.assertEqual(json.loads(row["referenced_run_ids_json"]), ["run-smoke-contract-001"])

    def test_repository_does_not_silently_return_mismatched_run_artifacts(self) -> None:
        project = self._fixture("smoke_project.json")
        scenario = self._fixture("smoke_scenario.json")
        run = self._fixture("smoke_run.json")
        result = self._fixture("smoke_result.json")
        manifest = self._fixture("smoke_artifact_manifest.json")
        other_run = {**run, "run_id": "run-smoke-contract-002"}
        other_result = {
            **result,
            "result_id": "result-smoke-contract-002",
            "run_id": other_run["run_id"],
        }
        other_manifest = {
            **manifest,
            "artifact_manifest_id": "artifact-manifest-smoke-contract-002",
            "run_id": other_run["run_id"],
        }

        self.repository.upsert_project(project)
        self.repository.upsert_scenario(scenario)
        self.repository.upsert_run(run)
        self.repository.upsert_run(other_run)
        self.repository.upsert_result_summary(other_result)
        self.repository.upsert_artifact_manifest(other_manifest)
        self.connection.execute(
            """
            UPDATE simulation_runs
            SET result_summary_id = ?, artifact_manifest_id = ?
            WHERE run_id = ?
            """,
            (
                other_result["result_id"],
                other_manifest["artifact_manifest_id"],
                run["run_id"],
            ),
        )
        self.connection.commit()

        with self.assertRaisesRegex(ValueError, "identity chain mismatch"):
            self.repository.get_run_chain(run["run_id"])


if __name__ == "__main__":
    unittest.main()
