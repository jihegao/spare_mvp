from __future__ import annotations

import json
from pathlib import Path
import tempfile
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

    def test_phase_6p_case_pack_freezes_two_modeling_import_cases(self) -> None:
        pack = build_simulation_analysis_case_pack(REPO_ROOT)

        self.assertEqual(pack["schema_version"], "simulation-analysis-case-pack-v0")
        self.assertEqual([case["case_id"] for case in pack["cases"]], SIMULATION_ANALYSIS_CASE_IDS)
        by_id = {case["case_id"]: case for case in pack["cases"]}
        self.assertEqual(set(by_id), {"minimal_single_aircraft", "canonical_platform_case"})
        self.assertEqual(by_id["minimal_single_aircraft"]["validation_level"], "level0")
        self.assertEqual(by_id["canonical_platform_case"]["validation_level"], "level1")
        self.assertFalse(by_id["minimal_single_aircraft"]["used_tables"]["supportResources"])
        self.assertFalse(by_id["minimal_single_aircraft"]["used_tables"]["supportActivities"])
        self.assertTrue(by_id["canonical_platform_case"]["used_tables"]["supportResources"])
        self.assertNotIn("supportResources", by_id["minimal_single_aircraft"]["modeling_import"]["objects"])
        self.assertNotIn("supportActivities", by_id["minimal_single_aircraft"]["modeling_import"]["objects"])
        self.assertEqual(by_id["minimal_single_aircraft"]["modeling_import"]["objects"]["equipment"]["quantity"], 1)
        self.assertEqual(
            len(by_id["minimal_single_aircraft"]["modeling_import"]["objects"]["missionProfiles"][0]["combatUnit"]["members"]),
            1,
        )
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

    def test_phase_6p_cases_validate_compile_and_emit_formal_analysis_artifacts(self) -> None:
        required_kinds = {
            "monte_carlo_base",
            "visualization_state_series",
            "analysis_projection_spare_shortfall",
            "analysis_projection_carry_list",
            "analysis_projection_mission_reliability",
            "analysis_projection_downtime_factors",
        }

        for case_id in SIMULATION_ANALYSIS_CASE_IDS:
            with self.subTest(case_id=case_id):
                fixture = self._load_case(case_id)
                validation = validate_modeling_import_package(fixture["modeling_import"])
                self.assertEqual(validation["issues"], [])
                self.assertTrue(validation["ok"])
                self.assertEqual(validation["validationLevel"], fixture["validation_level"])
                self.assertEqual(validation["usedTables"], fixture["used_tables"])
                project = fixture["project"]
                scenario = self.adapter.compile_scenario(project, model_family="aircraft_support_v1")
                config = fixture["monte_carlo_config"]
                with tempfile.TemporaryDirectory() as tmp:
                    bundle = self.adapter.run_monte_carlo_scenario(
                        scenario,
                        output_dir=Path(tmp),
                        run_id=f"run-6p-{case_id}",
                        monte_carlo_config=config,
                    )
                    manifest = bundle["artifact_manifest"]
                    kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
                    self.assertTrue(required_kinds <= kinds)
                    base_artifact = next(
                        artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base"
                    )
                    state_artifact = next(
                        artifact for artifact in manifest["artifacts"] if artifact["kind"] == "visualization_state_series"
                    )
                    base_payload = json.loads((Path(tmp) / base_artifact["path"]).read_text(encoding="utf-8"))
                    self.assertEqual(base_payload["model_family"], "aircraft_support_v1")
                    self.assertEqual(base_payload["sample_count"], config["sample_count"])
                    state_payload = json.loads((Path(tmp) / state_artifact["path"]).read_text(encoding="utf-8"))
                    self.assertEqual(state_payload["model_family"], "aircraft_support_v1")
                    self.assertEqual(state_payload["run_id"], f"run-6p-{case_id}")
                    self.assertTrue(state_payload["frames"])
                    first_mission = {
                        **state_payload["mission_templates"][state_payload["frames"][0]["missions"][0]["mission_id"]],
                        **state_payload["frames"][0]["missions"][0],
                    }
                    for key in (
                        "day_index",
                        "wave_index",
                        "required_aircraft_type",
                        "required_aircraft",
                        "duration_minutes",
                        "assigned_tail_numbers",
                    ):
                        self.assertIn(key, first_mission)
                    for artifact in manifest["artifacts"]:
                        if artifact["kind"].startswith("analysis_projection_"):
                            self.assertEqual(artifact["source_artifact_id"], base_artifact["artifact_id"])
                            self.assertIn("analysis_type", artifact)
                            self.assertIn("sha256", artifact)
                            self.assertIn("size_bytes", artifact)
                            payload = json.loads((Path(tmp) / artifact["path"]).read_text(encoding="utf-8"))
                            self.assertEqual(payload["model_family"], "aircraft_support_v1")
                            self.assertEqual(payload["run_id"], f"run-6p-{case_id}")
                            self.assertEqual(payload["base_artifact_id"], base_artifact["artifact_id"])
                            self.assertIn("data", payload)


if __name__ == "__main__":
    unittest.main()
