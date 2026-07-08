from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_SCRIPT = REPO_ROOT / "local-skills" / "aircraft-support-v1-project" / "scripts" / "aircraft_support_v1_project.py"


def _load_skill_module():
    spec = importlib.util.spec_from_file_location("aircraft_support_v1_project_skill", SKILL_SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load skill script from {SKILL_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AircraftSupportV1ProjectSkillTest(unittest.TestCase):
    def _project(self) -> dict:
        return json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "clean_projects" / "minimal_clean_project.json").read_text(
                encoding="utf-8"
            )
        )

    def test_lists_and_selects_backend_project_from_sqlite_without_repository_imports(self) -> None:
        skill = _load_skill_module()
        self.assertFalse(skill.uses_formal_project_path())

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "spare_mvp.sqlite3"
            connection = sqlite3.connect(db_path)
            project = self._project()
            connection.execute(
                """
                CREATE TABLE projects (
                  project_id TEXT PRIMARY KEY,
                  schema_version TEXT,
                  project_version TEXT,
                  active_module TEXT,
                  payload_json TEXT NOT NULL,
                  updated_at TEXT
                )
                """
            )
            connection.execute(
                """
                INSERT INTO projects (
                  project_id, schema_version, project_version, active_module, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    project["project_id"],
                    project["schema_version"],
                    project["project_version"],
                    project["activeModule"],
                    json.dumps(project, ensure_ascii=False),
                    "2026-07-08T00:00:00Z",
                ),
            )
            connection.commit()
            connection.close()

            catalog = skill.list_backend_projects(db_path)
            self.assertEqual([entry["project_id"] for entry in catalog], [project["project_id"]])
            self.assertEqual(catalog[0]["scenario_id"], project["scenarioId"])

            selected = skill.load_backend_project(db_path, project["project_id"])
            self.assertEqual(selected["project_id"], project["project_id"])

    def test_remembers_modeling_table_structure_and_explains_four_domains(self) -> None:
        skill = _load_skill_module()
        project = self._project()

        with tempfile.TemporaryDirectory() as tmp:
            memory_path = Path(tmp) / "schema-memory.json"
            memory = skill.remember_project_structure(project, memory_path=memory_path, project_source="unit-test")

            self.assertTrue(memory_path.exists())
            self.assertEqual(memory["project_id"], project["project_id"])
            self.assertIn("basicMissions", memory["tables"])
            self.assertIn("components", memory["tables"])
            self.assertIn("supportActivities.jobs", memory["tables"])
            self.assertIn("durationHours", memory["tables"]["missionProfile"]["fields"])

            explanation = skill.explain_project(project, memory=memory)
            self.assertEqual(list(explanation), ["任务", "装备", "保障组织", "保障活动"])
            self.assertGreaterEqual(explanation["任务"]["row_count"], 1)
            self.assertGreaterEqual(explanation["装备"]["row_count"], 1)
            self.assertGreaterEqual(explanation["保障组织"]["row_count"], 1)
            self.assertGreaterEqual(explanation["保障活动"]["row_count"], 1)

    def test_compiles_project_json_and_runs_aircraft_support_v1_without_simulation_adapter(self) -> None:
        skill = _load_skill_module()
        project = self._project()

        inputs = skill.compile_project_json_to_aircraft_support_inputs(
            project,
            runtime_config={"duration_minutes": 60, "sample_every_minutes": 15, "seed": 7},
        )

        self.assertEqual(inputs["schema_version"], "aircraft-support-v1-input-v0")
        self.assertEqual(inputs["project_identity"]["project_id"], project["project_id"])
        self.assertEqual(inputs["aircraft"]["fleet_count"], 1)
        self.assertEqual(inputs["support_activities"]["activities"][0]["jobs"][0]["activityCode"], "job-1")

        result = skill.run_aircraft_support_v1_project(
            project,
            repo_root=REPO_ROOT,
            runtime_config={"duration_minutes": 60, "sample_every_minutes": 15, "seed": 7},
        )

        self.assertEqual(result["model_family"], "aircraft_support_v1")
        self.assertEqual(result["project_id"], project["project_id"])
        self.assertIn("metrics", result)
        self.assertIn("frames", result)
        self.assertGreaterEqual(len(result["frames"]), 2)


if __name__ == "__main__":
    unittest.main()
