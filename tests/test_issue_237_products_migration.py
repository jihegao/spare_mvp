from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "migrate-issue-237-products.py"
SPEC = importlib.util.spec_from_file_location("migrate_issue_237_products", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class Issue237ProductsMigrationTest(unittest.TestCase):
    def _legacy_project(self) -> dict:
        return {
            "project_id": "project-legacy-products",
            "components": [
                {
                    "id": "j15-engine",
                    "name": "J-15发动机",
                    "productType": "LRU",
                    "spareType": "旧发动机备件",
                    "quantity": 1,
                },
                {
                    "id": "j35-radar",
                    "name": "J-35雷达",
                    "productType": "LRU",
                    "quantity": 1,
                },
            ],
            "supportResources": [
                {
                    "id": "carrier-engine-spare",
                    "type": "spare",
                    "name": "舰载发动机备件",
                    "model": "j15-engine",
                    "quantity": 4,
                },
                {
                    "id": "carrier-independent-spare",
                    "type": "spare",
                    "name": "独立保障件",
                    "model": "independent-model",
                    "quantity": 2,
                },
            ],
            "transportPolicies": [
                {"id": "engine-policy", "name": "发动机补给", "spareType": "J-15发动机"},
                {"id": "all-products-policy", "name": "全品类补给"},
            ],
            "supportActivityJobs": [
                {
                    "activityCode": "repair-engine",
                    "spare": [{"name": "J-15发动机", "model": "j15-engine", "quantity": 1, "spareType": "旧发动机备件"}],
                }
            ],
        }

    def test_migration_is_deterministic_idempotent_and_links_resource_model_to_component(self) -> None:
        original = self._legacy_project()

        migrated = migration.migrate_project_products(original)
        migrated_again = migration.migrate_project_products(migrated)

        self.assertEqual(migrated_again, migrated)
        self.assertEqual(original["components"][0]["spareType"], "旧发动机备件")
        self.assertTrue(all("spareType" not in component for component in migrated["components"]))
        engine = migrated["components"][0]
        engine_resource = migrated["supportResources"][0]
        self.assertEqual(engine_resource["productId"], engine["productId"])
        self.assertEqual(engine["name"], "J-15发动机")
        self.assertEqual(engine_resource["name"], "舰载发动机备件")
        product_names = {product["name"] for product in migrated["products"]}
        self.assertIn("旧发动机备件", product_names)
        self.assertIn("J-35雷达", product_names)
        self.assertIn("独立保障件", product_names)
        self.assertEqual(migrated["transportPolicies"][0]["productId"], engine["productId"])
        self.assertNotIn("spareType", migrated["transportPolicies"][0])
        self.assertNotIn("productId", migrated["transportPolicies"][1])
        activity_spare = migrated["supportActivityJobs"][0]["spare"][0]
        self.assertEqual(activity_spare["productId"], engine["productId"])
        self.assertNotIn("spareType", activity_spare)

    def test_database_write_creates_json_backup_before_updating_and_second_run_is_clean(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "spare_mvp.sqlite3"
            backup = Path(tmp) / "issue-237-backup.json"
            with sqlite3.connect(database) as connection:
                connection.execute(
                    """
                    CREATE TABLE projects (
                      project_id TEXT PRIMARY KEY,
                      payload_json TEXT NOT NULL,
                      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE modeling_snapshots (
                      snapshot_id TEXT PRIMARY KEY,
                      payload_json TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE experiment_plans (
                      experiment_plan_id TEXT PRIMARY KEY,
                      payload_json TEXT NOT NULL,
                      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO projects (project_id, payload_json) VALUES (?, ?)",
                    ("project-legacy-products", json.dumps(self._legacy_project(), ensure_ascii=False)),
                )
                connection.execute(
                    "INSERT INTO modeling_snapshots (snapshot_id, payload_json) VALUES (?, ?)",
                    ("snapshot-legacy-products", json.dumps({"project": self._legacy_project()}, ensure_ascii=False)),
                )
                connection.execute(
                    "INSERT INTO experiment_plans (experiment_plan_id, payload_json) VALUES (?, ?)",
                    (
                        "plan-legacy-products",
                        json.dumps({"config": {"projectJson": self._legacy_project()}}, ensure_ascii=False),
                    ),
                )

            report, written_backup = migration.migrate_database(database, write=True, backup_path=backup)

            self.assertEqual(report["projects"], ["project-legacy-products"])
            self.assertEqual(report["modeling_snapshots"], ["snapshot-legacy-products"])
            self.assertEqual(report["experiment_plans"], ["plan-legacy-products"])
            self.assertEqual(written_backup, backup.resolve())
            backup_payload = json.loads(backup.read_text(encoding="utf-8"))
            self.assertNotIn("products", backup_payload["tables"]["projects"][0]["payload"])
            self.assertIn("spareType", backup_payload["tables"]["projects"][0]["payload"]["components"][0])
            with sqlite3.connect(database) as connection:
                migrated = json.loads(connection.execute("SELECT payload_json FROM projects").fetchone()[0])
                snapshot = json.loads(connection.execute("SELECT payload_json FROM modeling_snapshots").fetchone()[0])
                plan = json.loads(connection.execute("SELECT payload_json FROM experiment_plans").fetchone()[0])
            self.assertIn("products", migrated)
            self.assertNotIn("spareType", migrated["components"][0])
            self.assertEqual(snapshot["project"], migrated)
            self.assertEqual(plan["config"]["projectJson"], migrated)

            report, written_backup = migration.migrate_database(database, write=True, backup_path=Path(tmp) / "unused.json")
            self.assertTrue(all(not row_ids for row_ids in report.values()))
            self.assertIsNone(written_backup)


if __name__ == "__main__":
    unittest.main()
