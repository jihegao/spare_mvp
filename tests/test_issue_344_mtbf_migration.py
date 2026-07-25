from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from src.spare_mvp_backend.repository import initialize_database


REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_SCRIPT = REPO_ROOT / "scripts" / "migrate-issue-344-mtbf.py"


class Issue344MtbfMigrationCommandTest(unittest.TestCase):
    def test_check_is_read_only_and_write_is_backup_backed_transactional_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "runtime.sqlite3"
            check_report = root / "check.json"
            write_report = root / "write.json"
            second_report = root / "write-second.json"
            backup_dir = root / "backups"
            legacy_project = {
                "project_id": "project-issue-344",
                "schema_version": "project-v0",
                "project_version": "project-v0.1",
                "products": [{
                    "id": "product-shared",
                    "name": "共享产品",
                    "mtbfHours": 500,
                    "failureDistribution": {
                        "distributionType": "指数分布",
                        "lambda": 0.002,
                    },
                }],
                "components": [{
                    "id": "component-a",
                    "name": "组件 A",
                    "productId": "product-shared",
                    "failureDistribution": {
                        "distributionType": "exponential",
                        "parameters": "failure_rate=0.002",
                    },
                }],
            }
            with sqlite3.connect(database) as connection:
                initialize_database(connection)
                connection.execute("DELETE FROM schema_migrations WHERE version = 7")
                connection.execute(
                    """
                    INSERT INTO projects (
                      project_id, schema_version, project_version, payload_json
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        legacy_project["project_id"],
                        legacy_project["schema_version"],
                        legacy_project["project_version"],
                        json.dumps(legacy_project, ensure_ascii=False),
                    ),
                )
                historical_project = json.loads(json.dumps(legacy_project))
                historical_project["products"][0]["mtbfHours"] = 400
                snapshot_payload = {
                    "snapshot_id": "snapshot-issue-344",
                    "project_id": legacy_project["project_id"],
                    "schema_version": "modeling-snapshot-v0",
                    "project_version": legacy_project["project_version"],
                    "project": historical_project,
                }
                experiment_payload = {
                    "experiment_plan_id": "experiment-issue-344",
                    "project_id": legacy_project["project_id"],
                    "modeling_snapshot_id": "snapshot-issue-344",
                    "schema_version": "experiment-plan-v0",
                    "project_version": legacy_project["project_version"],
                    "status": "draft",
                    "config": {"projectJson": historical_project},
                }
                connection.execute(
                    """
                    INSERT INTO modeling_snapshots (
                      snapshot_id, project_id, schema_version, project_version, payload_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot_payload["snapshot_id"],
                        legacy_project["project_id"],
                        snapshot_payload["schema_version"],
                        legacy_project["project_version"],
                        json.dumps(snapshot_payload, ensure_ascii=False),
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO experiment_plans (
                      experiment_plan_id, project_id, modeling_snapshot_id,
                      schema_version, project_version, status, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        experiment_payload["experiment_plan_id"],
                        legacy_project["project_id"],
                        experiment_payload["modeling_snapshot_id"],
                        experiment_payload["schema_version"],
                        legacy_project["project_version"],
                        experiment_payload["status"],
                        json.dumps(experiment_payload, ensure_ascii=False),
                    ),
                )
                connection.commit()
                original_payload = connection.execute(
                    "SELECT payload_json FROM projects WHERE project_id = ?",
                    (legacy_project["project_id"],),
                ).fetchone()[0]
                original_snapshot = connection.execute(
                    "SELECT payload_json FROM modeling_snapshots WHERE snapshot_id = ?",
                    (snapshot_payload["snapshot_id"],),
                ).fetchone()[0]
                original_experiment = connection.execute(
                    "SELECT payload_json FROM experiment_plans WHERE experiment_plan_id = ?",
                    (experiment_payload["experiment_plan_id"],),
                ).fetchone()[0]

            checked = self._run(
                "--check",
                "--database",
                str(database),
                "--report",
                str(check_report),
            )
            self.assertIn("pending=1 conflicts=0", checked.stdout)
            checked_report = json.loads(check_report.read_text(encoding="utf-8"))
            self.assertEqual(checked_report["summary"]["historical_context_issues"], 2)
            self.assertTrue(all(
                context["mutated"] is False
                for context in checked_report["historical_contexts"]
            ))
            with sqlite3.connect(database) as connection:
                self.assertEqual(
                    connection.execute(
                        "SELECT payload_json FROM projects WHERE project_id = ?",
                        (legacy_project["project_id"],),
                    ).fetchone()[0],
                    original_payload,
                )
                self.assertIsNone(
                    connection.execute(
                        "SELECT version FROM schema_migrations WHERE version = 7"
                    ).fetchone()
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT payload_json FROM modeling_snapshots WHERE snapshot_id = ?",
                        (snapshot_payload["snapshot_id"],),
                    ).fetchone()[0],
                    original_snapshot,
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT payload_json FROM experiment_plans WHERE experiment_plan_id = ?",
                        (experiment_payload["experiment_plan_id"],),
                    ).fetchone()[0],
                    original_experiment,
                )

            written = self._run(
                "--write",
                "--database",
                str(database),
                "--backup-dir",
                str(backup_dir),
                "--report",
                str(write_report),
            )
            self.assertIn("pending=0 conflicts=0", written.stdout)
            report = json.loads(write_report.read_text(encoding="utf-8"))
            backup = Path(report["backup"])
            self.assertTrue(backup.is_file())
            self.assertEqual(backup.parent, backup_dir)

            with sqlite3.connect(database) as connection:
                project = json.loads(
                    connection.execute(
                        "SELECT payload_json FROM projects WHERE project_id = ?",
                        (legacy_project["project_id"],),
                    ).fetchone()[0]
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT name FROM schema_migrations WHERE version = 7"
                    ).fetchone()[0],
                    "project_failure_distribution_rate_canonicalization",
                )
                self.assertEqual(connection.execute("PRAGMA quick_check").fetchone()[0], "ok")
                self.assertEqual(
                    connection.execute(
                        "SELECT payload_json FROM modeling_snapshots WHERE snapshot_id = ?",
                        (snapshot_payload["snapshot_id"],),
                    ).fetchone()[0],
                    original_snapshot,
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT payload_json FROM experiment_plans WHERE experiment_plan_id = ?",
                        (experiment_payload["experiment_plan_id"],),
                    ).fetchone()[0],
                    original_experiment,
                )
            for owner in [project["products"][0], project["components"][0]]:
                self.assertEqual(
                    owner["failureDistribution"],
                    {"distributionType": "指数分布", "rate": 0.002},
                )
                self.assertNotIn("mtbfHours", owner)

            second = self._run(
                "--write",
                "--database",
                str(database),
                "--backup-dir",
                str(backup_dir),
                "--report",
                str(second_report),
            )
            self.assertIn("backup: not required", second.stdout)
            self.assertEqual(len(list(backup_dir.glob("*.sqlite3"))), 1)

    def test_write_backs_up_before_registering_migration_without_payload_updates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "canonical.sqlite3"
            backup_dir = root / "backups"
            report_path = root / "write.json"
            with sqlite3.connect(database) as connection:
                initialize_database(connection)
                connection.execute("DELETE FROM schema_migrations WHERE version = 7")
                connection.commit()

            result = self._run(
                "--write",
                "--database",
                str(database),
                "--backup-dir",
                str(backup_dir),
                "--report",
                str(report_path),
            )

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertIn("pending=0 conflicts=0", result.stdout)
            self.assertTrue(Path(report["backup"]).is_file())
            with sqlite3.connect(database) as connection:
                self.assertEqual(
                    connection.execute(
                        "SELECT name FROM schema_migrations WHERE version = 7"
                    ).fetchone()[0],
                    "project_failure_distribution_rate_canonicalization",
                )

    def test_write_refuses_to_run_other_compatibility_migrations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "old.sqlite3"
            backup_dir = root / "backups"
            with sqlite3.connect(database) as connection:
                initialize_database(connection)
                connection.execute("DELETE FROM schema_migrations WHERE version IN (6, 7)")
                connection.commit()

            result = subprocess.run(
                [
                    sys.executable,
                    str(MIGRATION_SCRIPT),
                    "--write",
                    "--database",
                    str(database),
                    "--backup-dir",
                    str(backup_dir),
                    "--report",
                    str(root / "write.json"),
                ],
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("migration 6 must be", result.stderr)
            self.assertFalse(backup_dir.exists())
            with sqlite3.connect(database) as connection:
                self.assertIsNone(
                    connection.execute(
                        "SELECT version FROM schema_migrations WHERE version = 7"
                    ).fetchone()
                )

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MIGRATION_SCRIPT), *arguments],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
