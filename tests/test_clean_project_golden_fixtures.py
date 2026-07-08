from __future__ import annotations

import json
from pathlib import Path
import unittest

import jsonschema

from src.spare_mvp_backend.m9_6_case_package import m9_6_golden_fixture_drift
from src.spare_mvp_backend.modeling_import import modeling_import_to_project
from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_backend.simulation_analysis_cases import simulation_analysis_case_fixture_drift
from tests.clean_project_fixture_cases import (
    add_frontend_drift_fields,
    clean_project_fixture_payloads,
    legacy_polluted_project,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
CLEAN_FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "clean_projects"


class CleanProjectGoldenFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        schema = json.loads(
            (REPO_ROOT / "contracts" / "aircraft_support_v1_project.schema.json").read_text(encoding="utf-8")
        )
        jsonschema.Draft202012Validator.check_schema(schema)
        self.validator = jsonschema.Draft202012Validator(schema)

    def _load_clean_fixture(self, name: str) -> dict:
        return json.loads((CLEAN_FIXTURE_DIR / name).read_text(encoding="utf-8"))

    def _schema_errors(self, project: dict) -> list[jsonschema.ValidationError]:
        return sorted(self.validator.iter_errors(project), key=lambda error: list(error.path))

    def test_authoritative_source_fixture_generators_are_current(self) -> None:
        self.assertEqual(simulation_analysis_case_fixture_drift(REPO_ROOT), [])
        self.assertEqual(m9_6_golden_fixture_drift(REPO_ROOT), [])

    def test_clean_project_golden_fixtures_match_current_exporter_outputs(self) -> None:
        drifted = []
        for name, expected in clean_project_fixture_payloads(REPO_ROOT).items():
            fixture_path = CLEAN_FIXTURE_DIR / name
            if not fixture_path.exists():
                drifted.append(name)
                continue
            if self._load_clean_fixture(name) != expected:
                drifted.append(name)

        self.assertEqual(drifted, [])

    def test_clean_project_golden_fixtures_are_schema_valid(self) -> None:
        for name in sorted(clean_project_fixture_payloads(REPO_ROOT)):
            with self.subTest(name=name):
                fixture = self._load_clean_fixture(name)
                self.assertEqual(self._schema_errors(fixture), [])

    def test_exporter_check_blocks_frontend_field_drift_into_model_input(self) -> None:
        exporter = ProjectJsonExporter(target="aircraft_support_v1", repo_root=REPO_ROOT)
        golden = self._load_clean_fixture("legacy_polluted_clean_project.json")

        clean = exporter.export(add_frontend_drift_fields(legacy_polluted_project()))

        self.assertEqual(clean, golden)
        self.assertNotIn("artifactManifest", clean)
        self.assertNotIn("uiState", clean["components"][0])
        self.assertNotIn("draftState", clean["supportActivities"][0])
        self.assertNotIn("futureUiPanelState", clean["supportActivities"][0]["jobs"][0])
        self.assertNotIn("canvasLayout", clean["reliabilityBlockDiagram"]["nodes"][0])
        self.assertNotIn("futureFrontendPanelState", clean["reliabilityBlockDiagram"]["nodes"][0])

    def test_public_template_m9_6_and_clean_fixture_derivation_stays_locked(self) -> None:
        public_template = json.loads(
            (REPO_ROOT / "public/import-templates/canonical_platform_case.json").read_text(encoding="utf-8")
        )
        simulation_case = json.loads(
            (REPO_ROOT / "tests/fixtures/simulation_analysis_cases/canonical_platform_case.json").read_text(
                encoding="utf-8"
            )
        )
        m9_6_export = json.loads((REPO_ROOT / "tests/fixtures/m9_6_platform_case_export.json").read_text(encoding="utf-8"))
        exporter = ProjectJsonExporter(target="aircraft_support_v1", repo_root=REPO_ROOT)

        self.assertEqual(public_template, simulation_case["modeling_import"])
        self.assertEqual(
            exporter.export(m9_6_export["project"]),
            self._load_clean_fixture("full_platform_case_clean_project.json"),
        )
        self.assertEqual(
            exporter.export(m9_6_export["modeling_snapshot"]["projectJson"]),
            self._load_clean_fixture("full_platform_case_clean_project.json"),
        )

        public_clean_project = exporter.export(modeling_import_to_project(public_template))
        self.assertEqual(self._schema_errors(public_clean_project), [])
        self.assertEqual(
            self._load_clean_fixture("full_platform_case_clean_project.json")["modelingImportValidation"]["importId"],
            m9_6_export["published_modeling_import"]["importId"],
        )
        self.assertEqual(public_clean_project["modelingImportValidation"]["importId"], public_template["importId"])


if __name__ == "__main__":
    unittest.main()
