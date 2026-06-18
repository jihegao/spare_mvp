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
        self.connection.row_factory = sqlite3.Row
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)

    def tearDown(self) -> None:
        self.connection.close()

    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def test_schema_declares_required_persistence_tables(self) -> None:
        self.assertTrue(SCHEMA_PATH.exists())
        tables = {
            row["name"]
            for row in self.connection.execute(
                "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
            )
        }

        self.assertEqual(
            tables,
            {
                "projects",
                "users",
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
            },
            "artifact_manifests": {
                "artifact_manifest_id",
                "run_id",
                "scenario_id",
                "scenario_version",
                "schema_version",
                "payload_json",
            },
        }

        for table, columns in required_columns.items():
            with self.subTest(table=table):
                actual = {row["name"] for row in self.connection.execute(f"pragma table_info({table})")}
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


if __name__ == "__main__":
    unittest.main()
