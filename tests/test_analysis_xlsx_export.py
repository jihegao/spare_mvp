from __future__ import annotations

import io
import unittest
from unittest import mock

from openpyxl import load_workbook

from src.spare_mvp_backend.analysis_xlsx import (
    AnalysisXlsxError,
    MAX_DETAIL_ROWS,
    SUPPORTED_ANALYSIS_TYPES,
    _text_display_width,
    export_analysis_snapshot_xlsx,
)


class AnalysisXlsxExportTest(unittest.TestCase):
    CRITICAL_HEADERS_BY_ANALYSIS_TYPE = {
        "spare_shortfall": "平均备件延误时间(h)",
        "carry_list": "建议携行数量",
        "aircraft_mission_reliability": "整机任务可靠度",
        "mission_reliability": "整周期任务可靠度",
        "downtime_factors": "累计停机时长（小时）",
    }

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

    def test_task_reliability_keeps_summary_rounding_and_every_sample_wave_row(self) -> None:
        payload = self._payload("mission_reliability")
        payload["summary"] = [
            ["出动架次率", "0.502", ""],
            ["波次成功率", "12.2%", "%"],
            ["整周期任务可靠度", "66.7%", "%"],
            ["任务周期", "21.25 天", "天"],
            ["仿真总次数", 2, "次"],
            ["成功次数", 1, "次"],
        ]
        payload["detail_sections"][0] = {
            "title": "逐样本逐波次任务可靠度明细",
            "columns": ["样本", "波次", "成功比例"],
            "rows": [
                ["样本 1", "第1天 第1波", "100%"],
                ["样本 1", "第1天 第2波", "50%"],
                ["样本 2", "第1天 第1波", "0%"],
            ],
        }
        workbook = load_workbook(
            io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]),
            data_only=False,
        )
        self.assertEqual(
            [workbook["结果摘要"].cell(row=index, column=2).value for index in range(2, 8)],
            ["0.502", "12.2%", "66.7%", "21.25 天", 2, 1],
        )
        self.assertEqual(
            [
                [workbook["结果明细"].cell(row=row, column=column).value for column in range(1, 4)]
                for row in range(3, 6)
            ],
            [
                ["样本 1", "第1天 第1波", "100%"],
                ["样本 1", "第1天 第2波", "50%"],
                ["样本 2", "第1天 第1波", "0%"],
            ],
        )

    def test_all_five_analysis_types_keep_critical_chinese_headers_visible_and_wrapped(self) -> None:
        for analysis_type, critical_header in self.CRITICAL_HEADERS_BY_ANALYSIS_TYPE.items():
            with self.subTest(analysis_type=analysis_type):
                payload = self._payload(analysis_type)
                payload["detail_sections"] = [{
                    "title": "关键结果",
                    "columns": [critical_header, "说明"],
                    "rows": [["正常", "很长的结果内容" * 200]],
                }]

                workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
                sheet = workbook["结果明细"]
                header_cell = sheet["A2"]

                self.assertGreater(sheet.column_dimensions["A"].width, 12)
                self.assertLessEqual(sheet.column_dimensions["B"].width, 40)
                self.assertTrue(header_cell.alignment.wrap_text)
                self.assertGreaterEqual(sheet.row_dimensions[2].height, 30)

    def test_display_width_handles_cjk_ascii_newlines_and_combining_marks(self) -> None:
        self.assertEqual(_text_display_width("A中e\u0301\n飞机-X"), 6)

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

    def test_parallel_core_debug_field_is_omitted_or_localized_as_an_actionable_note(self) -> None:
        payload = self._payload("mission_reliability")
        payload["analysis_information"].append(["parallelCoresError", ""])
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        self.assertNotIn("parallelCoresError", [cell.value for row in workbook["分析信息"] for cell in row])

        payload["analysis_information"][-1][1] = "并行核心数必须为 1 到 8 的整数"
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        information = list(workbook["分析信息"].values)
        self.assertIn(("导出说明", "并行核心数配置异常：并行核心数必须为 1 到 8 的整数"), information)
        self.assertNotIn("parallelCoresError", [cell.value for row in workbook["分析信息"] for cell in row])

    def test_illegal_xml_controls_are_removed_but_tab_newline_and_carriage_return_remain(self) -> None:
        payload = self._payload("spare_shortfall")
        payload["detail_sections"][0]["rows"] = [["保留\t制表\n换行\r回车\x01\x08\x0b\x0c\x1f", "80%"]]
        workbook = load_workbook(io.BytesIO(export_analysis_snapshot_xlsx(payload)["body"]), data_only=False)
        self.assertEqual(workbook["结果明细"]["A3"].value, "保留\t制表\n换行\r回车")

    def test_openpyxl_write_failure_becomes_a_chinese_analysis_error(self) -> None:
        with mock.patch(
            "src.spare_mvp_backend.analysis_xlsx.Workbook.save",
            side_effect=ValueError("openpyxl write failed"),
        ):
            with self.assertRaisesRegex(AnalysisXlsxError, "包含无法写入 Excel 的字符或数值"):
                export_analysis_snapshot_xlsx(self._payload("spare_shortfall"))

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
