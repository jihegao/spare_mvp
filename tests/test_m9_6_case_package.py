from __future__ import annotations

import json
from pathlib import Path
import unittest

from src.spare_mvp_backend.m9_6_case_package import (
    build_m9_6_field_coverage,
    build_m9_6_platform_case_export,
    m9_6_expected_artifact_kinds,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


class M96CasePackageTest(unittest.TestCase):
    def _load_json(self, relative_path: str) -> dict:
        return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))

    def _canonical_import(self) -> dict:
        return self._load_json("tests/fixtures/modeling_import_project.json")

    def test_platform_case_export_freezes_import_to_run_chain(self) -> None:
        fixture = self._canonical_import()

        export = build_m9_6_platform_case_export(fixture, repo_root=REPO_ROOT)

        self.assertEqual(export["schema_version"], "m9-6-platform-case-export-v0")
        self.assertEqual(export["source_fixture"], "tests/fixtures/modeling_import_project.json")
        self.assertEqual(export["published_modeling_import"]["lifecycle"]["state"], "published")
        self.assertEqual(export["published_modeling_import"]["importId"], fixture["importId"])
        self.assertEqual(export["project"]["missionProfile"]["sourceImportId"], fixture["importId"])
        self.assertEqual(export["project"]["project_id"], fixture["projectId"])
        self.assertEqual(export["modeling_snapshot"]["project_id"], export["project"]["project_id"])
        self.assertEqual(export["modeling_snapshot"]["projectJson"], export["project"])
        self.assertEqual(export["experiment_plan"]["project_id"], export["project"]["project_id"])
        self.assertEqual(export["experiment_plan"]["config"]["projectJson"], export["project"])
        self.assertEqual(export["experiment_plan"]["config"]["analysisRequests"], export["project"]["analysisRequests"])
        self.assertEqual(export["run_intents"]["single"]["run_type"], "single")
        self.assertEqual(export["run_intents"]["single"]["model_family"], "aviation_support")
        self.assertEqual(export["run_intents"]["monte_carlo"]["run_type"], "monte_carlo")
        self.assertEqual(export["run_intents"]["monte_carlo"]["model_family"], "aviation_support")
        self.assertEqual(
            export["monte_carlo_config"],
            {
                "sample_count": 24,
                "sweep": {
                    "failureRates": [0.035, 0.055, 0.075],
                    "spareMultipliers": [0.75, 1.0, 1.25],
                    "supportCapacities": [2, 3, 4],
                },
                "mc_experiment_id": "mc-m9-6-platform-case",
            },
        )
        self.assertEqual(export["compiled_scenario"]["simulation_model"]["family"], "aviation_support")
        self.assertEqual(export["compiled_scenario"]["project_id"], export["project"]["project_id"])
        provenance = export["compiled_scenario"]["compiled_from"]["mapping_provenance"]
        self.assertEqual(provenance["modeling_snapshot_id"], export["modeling_snapshot"]["snapshot_id"])
        self.assertEqual(provenance["experiment_plan_id"], export["experiment_plan"]["experiment_plan_id"])
        self.assertEqual(
            export["validation"],
            {"ok": True, "schemaVersion": "modeling-import-v1", "status": "valid", "issues": []},
        )

    def test_field_coverage_explains_every_business_leaf_once(self) -> None:
        fixture = self._canonical_import()

        coverage = build_m9_6_field_coverage(fixture)

        allowed_statuses = {"consumed", "derived", "defaulted", "ignored", "unsupported"}
        leaf_paths = _business_leaf_paths(fixture)
        coverage_paths = [entry["field_path"] for entry in coverage["entries"]]
        self.assertEqual(coverage["schema_version"], "m9-6-field-coverage-v0")
        self.assertEqual(coverage["source_import_id"], fixture["importId"])
        self.assertEqual(sorted(coverage_paths), sorted(leaf_paths))
        self.assertEqual(len(coverage_paths), len(set(coverage_paths)))
        self.assertTrue({entry["status"] for entry in coverage["entries"]} <= allowed_statuses)
        self.assertTrue(all(entry["target"] for entry in coverage["entries"]))
        self.assertTrue(all(entry["rationale"] for entry in coverage["entries"]))
        self.assertIn("objects.supportActivities[].jobs[].durationProfile.distributionType", coverage_paths)
        self.assertIn("objects.equipmentAssets[].rms.availability", coverage_paths)
        self.assertIn("objects.analysisRequests.largeSample.sweep.failureRates[]", coverage_paths)
        entry_by_path = {entry["field_path"]: entry for entry in coverage["entries"]}
        self.assertEqual(entry_by_path["objects.equipmentAssets[].failureRate"]["status"], "ignored")
        self.assertEqual(entry_by_path["objects.supportResources[].capacity"]["status"], "ignored")
        self.assertEqual(entry_by_path["objects.equipment.initialReady"]["status"], "ignored")
        self.assertEqual(entry_by_path["objects.missionProfiles[].basicMission.minRequiredSorties"]["status"], "ignored")
        self.assertEqual(entry_by_path["objects.equipment.quantity"]["status"], "consumed")
        self.assertEqual(entry_by_path["objects.supportResources[].personnelCapacity"]["status"], "consumed")
        self.assertEqual(entry_by_path["objects.supportResources[].equipmentCapacity"]["status"], "consumed")

    def test_expected_artifact_kind_golden_lists_single_and_monte_carlo_outputs(self) -> None:
        artifact_kinds = m9_6_expected_artifact_kinds()

        self.assertEqual(artifact_kinds["schema_version"], "m9-6-expected-artifact-kinds-v0")
        self.assertEqual(
            artifact_kinds["single"],
            [
                "run_config",
                "input_project",
                "compiled_scenario",
                "snapshot",
                "result_summary",
                "metrics",
                "report",
                "log",
                "visualization_state_series",
                "analysis_projection_spare_shortfall",
                "analysis_projection_carry_list",
                "analysis_projection_mission_reliability",
                "analysis_projection_downtime_factors",
            ],
        )
        self.assertEqual(
            artifact_kinds["monte_carlo"],
            [
                "run_config",
                "input_project",
                "compiled_scenario",
                "sample_results",
                "aggregate_result",
                "result_summary",
                "metrics",
                "report",
                "log",
                "monte_carlo_base",
                "visualization_state_series",
                "analysis_projection_spare_shortfall",
                "analysis_projection_carry_list",
                "analysis_projection_mission_reliability",
                "analysis_projection_downtime_factors",
            ],
        )

    def test_generated_outputs_match_m9_6_golden_fixtures(self) -> None:
        fixture = self._canonical_import()

        self.assertEqual(
            build_m9_6_platform_case_export(fixture, repo_root=REPO_ROOT),
            self._load_json("tests/fixtures/m9_6_platform_case_export.json"),
        )
        self.assertEqual(
            build_m9_6_field_coverage(fixture),
            self._load_json("tests/fixtures/m9_6_field_coverage.json"),
        )
        self.assertEqual(
            m9_6_expected_artifact_kinds(),
            self._load_json("tests/fixtures/m9_6_expected_artifact_kinds.json"),
        )

def _business_leaf_paths(value: object, prefix: str = "") -> list[str]:
    if isinstance(value, dict):
        paths: list[str] = []
        for key in sorted(value):
            if prefix == "" and key in {"schemaVersion", "source", "lifecycle", "changes", "validation"}:
                continue
            paths.extend(_business_leaf_paths(value[key], f"{prefix}.{key}" if prefix else key))
        return paths
    if isinstance(value, list):
        if not value:
            return [prefix]
        paths = []
        for item in value:
            item_paths = _business_leaf_paths(item, f"{prefix}[]")
            for path in item_paths:
                if path not in paths:
                    paths.append(path)
        return paths
    return [prefix]


if __name__ == "__main__":
    unittest.main()
