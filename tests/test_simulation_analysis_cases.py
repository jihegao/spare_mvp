from __future__ import annotations

import json
from pathlib import Path
import unittest

from src.spare_mvp_backend.modeling_import import validate_modeling_import_package
from src.spare_mvp_backend.simulation_analysis_cases import (
    SIMULATION_ANALYSIS_CASE_IDS,
    build_simulation_analysis_case_pack,
    simulation_analysis_case_fixture_drift,
)
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class SimulationAnalysisCasePackTest(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = SimulationAdapter(REPO_ROOT)

    def _load_case(self, case_id: str) -> dict:
        path = REPO_ROOT / "tests" / "fixtures" / "simulation_analysis_cases" / f"{case_id}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_phase_6p_case_pack_freezes_canonical_modeling_import_case(self) -> None:
        pack = build_simulation_analysis_case_pack(REPO_ROOT)

        self.assertEqual(pack["schema_version"], "simulation-analysis-case-pack-v0")
        self.assertEqual([case["case_id"] for case in pack["cases"]], SIMULATION_ANALYSIS_CASE_IDS)
        by_id = {case["case_id"]: case for case in pack["cases"]}
        self.assertEqual(set(by_id), {"canonical_platform_case"})
        self.assertNotIn("validation_level", by_id["canonical_platform_case"])
        self.assertTrue(by_id["canonical_platform_case"]["used_tables"]["supportResources"])
        self.assertEqual(
            by_id["canonical_platform_case"]["source_fixture"],
            "tests/fixtures/case_new.json",
        )

    def test_phase_6p_fixture_files_match_generated_case_pack(self) -> None:
        self.assertEqual(simulation_analysis_case_fixture_drift(REPO_ROOT), [])
        self.assertFalse((REPO_ROOT / "public" / "import-templates" / "case_new.json").exists())
        self.assertFalse(
            (REPO_ROOT / "tests" / "fixtures" / "simulation_analysis_cases" / "max_granularity_multi_aircraft.json").exists()
        )
        self.assertFalse((REPO_ROOT / "public" / "import-templates" / "max_granularity_multi_aircraft.json").exists())
        self.assertFalse(
            (REPO_ROOT / "tests" / "fixtures" / "simulation_analysis_cases" / "minimal_single_aircraft.json").exists()
        )
        self.assertFalse((REPO_ROOT / "public" / "import-templates" / "minimal_single_aircraft.json").exists())

    def test_phase_6p_canonical_case_no_longer_declares_formal_analysis_artifacts(self) -> None:
        fixture = self._load_case("canonical_platform_case")

        self.assertNotIn("monte_carlo_config", fixture)
        self.assertNotIn("expected_artifact_kinds", fixture)

    def test_phase_6p_cases_validate_and_compile_without_formal_artifact_generation(self) -> None:
        for case_id in SIMULATION_ANALYSIS_CASE_IDS:
            with self.subTest(case_id=case_id):
                fixture = self._load_case(case_id)
                validation = validate_modeling_import_package(fixture["modeling_import"])
                self.assertEqual(validation["issues"], [])
                self.assertTrue(validation["ok"])
                self.assertNotIn("validationLevel", validation)
                self.assertNotIn("validation_level", fixture)
                self.assertEqual(validation["usedTables"], fixture["used_tables"])
                project = fixture["project"]
                scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
                self.assertEqual(scenario["project_id"], project["project_id"])
                self.assertEqual(scenario["simulation_model"]["family"], "aircraft_support_v1")
                self.assertEqual(
                    scenario["compiled_from"]["mapping_provenance"]["model_family"],
                    "aircraft_support_v1",
                )
                self.assertIn("supportResources", validation["usedTables"])
                self.assertNotIn("missionAreas", project)
                self.assertNotIn("missionAreas", project.get("missionProfile", {}))
                self.assertNotIn("mission_areas", scenario["simulation_inputs"]["mission_profile"])


if __name__ == "__main__":
    unittest.main()
