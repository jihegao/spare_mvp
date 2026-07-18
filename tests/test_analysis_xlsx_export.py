from __future__ import annotations

import io
import unittest

from openpyxl import load_workbook

from src.spare_mvp_backend.analysis_xlsx import (
    AnalysisXlsxError,
    MAX_DETAIL_ROWS,
    SUPPORTED_ANALYSIS_TYPES,
    export_analysis_snapshot_xlsx,
)


class AnalysisXlsxExportTest(unittest.TestCase):
    def _payload(self, analysis_type: str) -> dict:
        return {
            "analysis_type": analysis_type,
            "project_name": "案例/项目",
            "analysis_name": SUPPORTED_ANALYSIS_TYPES[analysis_type],
            "exported_at": "2026-07-18T10:11:12+08:00",
            "analysis_information": [
                ["分析时间", "2026-07-18T10:10:00+08:00"],
                ["实验方案名称", "方案A"],
                ["实验方案 ID", "plan-stable-a"],
                ["样本量", 27],
                ["随机种子", 20260718],
            ],
            "summary": [["当前指标", "80%", "%"]],
            "detail_sections": [{
                "title": "当前可见结果",
                "columns": ["名称", "显示值"],
                "rows": [["安全结果", "80%"]],
            }],
        }

    def test_all_five_analysis_types_generate_openable_three_sheet_ooxml(self) -> None:
        for analysis_type in SUPPORTED_ANALYSIS_TYPES:
            with self.subTest(analysis_type=analysis_type):
                download = export_analysis_snapshot_xlsx(self._payload(analysis_type))
                self.assertTrue(download["body"].startswith(b"PK"))
                self.assertEqual(
                    download["content_type"],
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                self.assertEqual(
                    download["filename"],
                    f"案例_项目-{SUPPORTED_ANALYSIS_TYPES[analysis_type]}-20260718-101112.xlsx",
                )
                workbook = load_workbook(io.BytesIO(download["body"]), data_only=False)
                self.assertEqual(workbook.sheetnames, ["分析信息", "结果摘要", "结果明细"])
                self.assertEqual(workbook["分析信息"]["A2"].value, "项目名称")
                self.assertEqual(workbook["分析信息"]["B2"].value, "案例/项目")
                self.assertEqual(workbook["结果摘要"]["B2"].value, "80%")
                self.assertEqual(workbook["结果明细"]["A3"].value, "安全结果")

    def test_task_reliability_keeps_canonical_half_even_display_fields_verbatim(self) -> None:
        payload = self._payload("mission_reliability")
        payload["summary"] = [
            ["出动架次率", "0.502", ""],
            ["波次成功率", "12.2%", "%"],
            ["整周期任务可靠度", "66.7%", "%"],
            ["任务周期", "21.25 天", "天"],
        ]
        payload["detail_sections"][0] = {
            "title": "任务可靠度结果",
            "columns": ["出动架次率", "波次成功率", "整周期任务可靠度", "任务周期"],
            "rows": [["0.502", "12.2%", "66.7%", "21.25 天"]],
        }
        workbook = load_workbook(
            io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]),
            data_only=False,
        )
        self.assertEqual(
            [workbook["结果摘要"].cell(row=index, column=2).value for index in range(2, 6)],
            ["0.502", "12.2%", "66.7%", "21.25 天"],
        )
        self.assertEqual(
            [workbook["结果明细"].cell(row=3, column=index).value for index in range(1, 5)],
            ["0.502", "12.2%", "66.7%", "21.25 天"],
        )

    def test_downtime_export_keeps_localized_day_time_and_excludes_internal_ids(self) -> None:
        payload = self._payload("downtime_factors")
        payload["detail_sections"] = [{
            "title": "停机事件明细",
            "columns": ["停机因素类型", "开始时间", "结束时间", "事件说明"],
            "rows": [["备件短缺", "DAY_2 00:01", "DAY_2 01:01", "飞机101所需备件短缺"]],
        }]
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        detail_values = [cell.value for row in workbook["结果明细"].iter_rows() for cell in row]
        self.assertIn("DAY_2 00:01", detail_values)
        self.assertIn("飞机101所需备件短缺", detail_values)
        self.assertNotIn("internal_run_id", detail_values)
        self.assertNotIn("debug", detail_values)

    def test_formula_like_strings_are_stored_as_text(self) -> None:
        payload = self._payload("spare_shortfall")
        payload["detail_sections"][0]["rows"] = [["=HYPERLINK(\"bad\")", "+1+1"]]
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        self.assertEqual(workbook["结果明细"]["A3"].value, "'=HYPERLINK(\"bad\")")
        self.assertEqual(workbook["结果明细"]["B3"].value, "'+1+1")
        self.assertEqual(workbook["结果明细"]["A3"].data_type, "s")

    def test_detail_rows_are_capped_with_an_explicit_information_note(self) -> None:
        payload = self._payload("carry_list")
        payload["detail_sections"][0]["rows"] = [[f"备件{index}", index] for index in range(MAX_DETAIL_ROWS + 2)]
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        self.assertEqual(workbook["结果明细"].max_row, MAX_DETAIL_ROWS + 2)
        info_rows = list(workbook["分析信息"].values)
        self.assertIn(("导出说明", f"明细超过 {MAX_DETAIL_ROWS} 行，已截断 2 行。"), info_rows)

    def test_invalid_or_empty_snapshot_returns_a_chinese_validation_error(self) -> None:
        payload = self._payload("spare_shortfall")
        payload["summary"] = []
        payload["detail_sections"] = []
        with self.assertRaisesRegex(AnalysisXlsxError, "当前页面没有可导出的分析结果"):
            export_analysis_snapshot_xlsx(payload)


if __name__ == "__main__":
    unittest.main()
