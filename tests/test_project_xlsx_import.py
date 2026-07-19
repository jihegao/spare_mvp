from __future__ import annotations

from io import BytesIO
import json
import unittest
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook

from src.spare_mvp_backend.project_xlsx import (
    MAX_XLSX_UNCOMPRESSED_BYTES,
    ProjectXlsxError,
    locate_issues,
    parse_project_xlsx,
    validate_import_relations,
)


def workbook_bytes(project_rows, sheets) -> bytes:
    workbook = Workbook()
    project = workbook.active
    project.title = "Project"
    project.append(["field", "value"])
    for row in project_rows:
        project.append(row)
    for name, headers, rows in sheets:
        sheet = workbook.create_sheet(name)
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


class ProjectXlsxImportTest(unittest.TestCase):
    def test_real_xlsx_maps_canonical_project_roots_and_nested_values(self) -> None:
        content = workbook_bytes(
            [
                ["schema_version", "project-v0"],
                ["project_id", "xlsx-project"],
                ["project_version", "import-v1"],
                ["projectInfo", json.dumps({"name": "Excel 项目"}, ensure_ascii=False)],
                ["missionProfile", json.dumps({"durationHours": 8, "compositeTasks": [], "periodicTasks": []})],
            ],
            [
                ("products", ["id", "name"], [["product-1", "航材"]]),
                ("components", ["id", "name", "productId", "quantity", "failureDistribution"], [["component-1", "整机", "product-1", 1, '{"distributionType":"exponential","rate":0.01}']]),
                ("airports", ["value"], [["机场 A"]]),
            ],
        )

        project, locations, errors = parse_project_xlsx(content)

        self.assertEqual(errors, [])
        self.assertEqual(project["projectInfo"]["name"], "Excel 项目")
        self.assertEqual(project["components"][0]["failureDistribution"]["rate"], 0.01)
        self.assertEqual(project["airports"], ["机场 A"])
        self.assertEqual(locations["components[0].productId"]["row"], 2)
        self.assertEqual(locations["components[0].productId"]["sheet"], "components")
        self.assertEqual(validate_import_relations(project), [])

    def test_relation_errors_include_duplicate_cycle_and_missing_task_reference_locations(self) -> None:
        profile = {
            "durationHours": 8,
            "compositeTasks": [{"id": "composite-1", "taskItems": [{"basicMissionId": "missing-basic"}]}],
            "periodicTasks": [{"id": "week-1", "compositeTaskIds": ["missing-composite"]}],
        }
        content = workbook_bytes(
            [["schema_version", "project-v0"], ["project_id", "invalid"], ["missionProfile", json.dumps(profile)]],
            [
                ("products", ["id", "name"], [["duplicate", "A"], ["duplicate", "B"]]),
                ("components", ["id", "parentId", "productId"], [["a", "b", "duplicate"], ["b", "a", "duplicate"]]),
                ("basicMissions", ["id", "name"], [["basic-1", "任务"]]),
            ],
        )
        project, locations, parse_errors = parse_project_xlsx(content)

        errors = locate_issues([*parse_errors, *validate_import_relations(project)], locations)

        codes = {error["code"] for error in errors}
        self.assertIn("duplicate_id", codes)
        self.assertIn("circular_component_parent", codes)
        self.assertIn("missing_basic_mission_reference", codes)
        self.assertIn("missing_composite_task_reference", codes)
        duplicate = next(error for error in errors if error["code"] == "duplicate_id")
        self.assertEqual((duplicate["sheet"], duplicate["row"], duplicate["field"]), ("products", 3, "id"))
        missing_basic = next(error for error in errors if error["code"] == "missing_basic_mission_reference")
        self.assertEqual(missing_basic["reference_value"], "missing-basic")
        self.assertEqual((missing_basic["sheet"], missing_basic["row"]), ("Project", 4))

    def test_unknown_sheet_and_invalid_json_cell_block_import_with_exact_location(self) -> None:
        content = workbook_bytes(
            [["schema_version", "project-v0"], ["missionProfile", "{broken"]],
            [("legacy-v2", ["id"], [["old"]])],
        )

        _, _, errors = parse_project_xlsx(content)

        self.assertEqual({error["code"] for error in errors}, {"unknown_sheet", "invalid_json_cell"})
        json_error = next(error for error in errors if error["code"] == "invalid_json_cell")
        self.assertEqual((json_error["sheet"], json_error["row"], json_error["field"]), ("Project", 3, "missionProfile"))

    def test_formula_cells_are_rejected_instead_of_using_stale_cached_values(self) -> None:
        content = workbook_bytes(
            [["schema_version", "project-v0"], ["project_id", "=CONCAT(\"unsafe\", \"-id\")"]],
            [],
        )

        project, _, errors = parse_project_xlsx(content)

        self.assertIsNone(project["project_id"])
        formula_error = next(error for error in errors if error["code"] == "formula_not_supported")
        self.assertEqual((formula_error["sheet"], formula_error["row"], formula_error["field"]), ("Project", 3, "project_id"))

    def test_zip_expansion_limit_rejects_highly_compressed_workbooks_before_openpyxl(self) -> None:
        output = BytesIO()
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("xl/worksheets/sheet1.xml", b"0" * (MAX_XLSX_UNCOMPRESSED_BYTES + 1))

        with self.assertRaisesRegex(ProjectXlsxError, "解压后超过"):
            parse_project_xlsx(output.getvalue())


if __name__ == "__main__":
    unittest.main()
