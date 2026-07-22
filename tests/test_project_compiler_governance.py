from __future__ import annotations

import json
from pathlib import Path
import unittest

import jsonschema

from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class ProjectCompilerGovernanceTest(unittest.TestCase):
    def test_retired_local_skill_is_not_published(self) -> None:
        skill_root = REPO_ROOT / "local-skills" / "aircraft-support-v1-project"
        self.assertFalse((skill_root / "SKILL.md").exists())
        self.assertFalse((skill_root / "agents" / "openai.yaml").exists())

    def test_canonical_project_compiles_through_formal_boundary_and_matches_input_schema(self) -> None:
        project = json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "clean_projects" / "minimal_clean_project.json").read_text(
                encoding="utf-8"
            )
        )
        clean_project = ProjectJsonExporter(target="aircraft_support_v1", repo_root=REPO_ROOT).export(project)

        scenario = SimulationAdapter(REPO_ROOT).compile_scenario(
            clean_project,
            model_family="aircraft_support_v1",
        )

        input_schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_input.schema.json").read_text(encoding="utf-8")
        )
        jsonschema.Draft202012Validator.check_schema(input_schema)
        jsonschema.Draft202012Validator(input_schema).validate(scenario["simulation_inputs"])
        self.assertEqual(scenario["simulation_inputs"]["schema_version"], "aircraft-support-v1-input-v0")


if __name__ == "__main__":
    unittest.main()
