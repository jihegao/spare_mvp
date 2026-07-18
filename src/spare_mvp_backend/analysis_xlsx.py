"""Generate safe, standards-compliant XLSX exports for analysis snapshots."""

from __future__ import annotations

from datetime import datetime, timezone
import io
import re
import unicodedata
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SUPPORTED_ANALYSIS_TYPES = {
    "spare_shortfall": "备件短板分析",
    "carry_list": "飞机转场携行清单分析",
    "aircraft_mission_reliability": "飞机任务可靠性评估",
    "mission_reliability": "任务可靠度评估",
    "downtime_factors": "停机因素分析",
}
MAX_DETAIL_ROWS = 10_000
MAX_DETAIL_COLUMNS = 40
MAX_CELL_TEXT = 32_000
_UNSAFE_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_ILLEGAL_XML_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")
_FORMULA_PREFIXES = ("=", "+", "-", "@")
MAX_COLUMN_WIDTH = 40


class AnalysisXlsxError(ValueError):
    """A user-facing validation failure for an analysis export snapshot."""


def export_analysis_snapshot_xlsx(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an OOXML workbook built only from the supplied visible snapshot."""
    if not isinstance(payload, dict):
        raise AnalysisXlsxError("导出请求格式无效，请刷新页面后重试。")
    analysis_type = str(payload.get("analysis_type") or "").strip()
    if analysis_type not in SUPPORTED_ANALYSIS_TYPES:
        raise AnalysisXlsxError("不支持当前分析类型的 Excel 导出。")

    project_name = _required_text(payload.get("project_name"), "项目名称")
    analysis_name = _required_text(
        payload.get("analysis_name") or SUPPORTED_ANALYSIS_TYPES[analysis_type],
        "分析类型",
    )
    information = _pair_rows(payload.get("analysis_information"), "分析信息")
    summary = _summary_rows(payload.get("summary"))
    sections, omitted_rows = _detail_sections(payload.get("detail_sections"))
    if not summary and not any(section["rows"] for section in sections):
        raise AnalysisXlsxError("当前页面没有可导出的分析结果。")

    try:
        workbook = Workbook()
        info_sheet = workbook.active
        info_sheet.title = "分析信息"
        _write_table(
            info_sheet,
            ["信息项", "内容"],
            [
                ["项目名称", project_name],
                ["分析类型", analysis_name],
                *information,
                *([["导出说明", f"明细超过 {MAX_DETAIL_ROWS} 行，已截断 {omitted_rows} 行。"]] if omitted_rows else []),
            ],
        )

        summary_sheet = workbook.create_sheet("结果摘要")
        _write_table(summary_sheet, ["指标名称", "值", "单位"], summary)

        detail_sheet = workbook.create_sheet("结果明细")
        if not sections:
            _write_table(detail_sheet, ["结果"], [["当前页面无明细表，仅导出结果摘要。"]])
        else:
            row_index = 1
            for section_index, section in enumerate(sections):
                if section_index:
                    row_index += 1
                detail_sheet.cell(row=row_index, column=1, value=_safe_cell_value(section["title"]))
                detail_sheet.cell(row=row_index, column=1).font = Font(bold=True, size=12)
                row_index += 1
                row_index = _write_table(
                    detail_sheet,
                    section["columns"],
                    section["rows"],
                    start_row=row_index,
                )
            _fit_columns(detail_sheet)

        workbook.properties.title = analysis_name
        workbook.properties.creator = "spare_mvp"
        output = io.BytesIO()
        workbook.save(output)
    except Exception as exc:
        raise AnalysisXlsxError("分析结果包含无法写入 Excel 的字符或数值，请检查后重试。") from exc
    return {
        "body": output.getvalue(),
        "content_type": XLSX_CONTENT_TYPE,
        "filename": analysis_export_filename(project_name, analysis_name, payload.get("exported_at")),
    }


def analysis_export_filename(project_name: str, analysis_name: str, exported_at: Any = None) -> str:
    timestamp = _export_timestamp(exported_at).strftime("%Y%m%d-%H%M%S")
    project_segment = _safe_filename_segment(project_name, "项目")
    analysis_segment = _safe_filename_segment(analysis_name, "分析结果")
    return f"{project_segment}-{analysis_segment}-{timestamp}.xlsx"


def _pair_rows(value: Any, label: str) -> list[list[Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise AnalysisXlsxError(f"{label}格式无效。")
    rows: list[list[Any]] = []
    for row in value:
        if not isinstance(row, list) or len(row) != 2:
            raise AnalysisXlsxError(f"{label}格式无效。")
        row_label = _safe_cell_value(row[0])
        row_value = _safe_cell_value(row[1])
        if row_label == "parallelCoresError":
            if str(row_value).strip():
                rows.append(["导出说明", f"并行核心数配置异常：{row_value}"])
            continue
        rows.append([row_label, row_value])
    return rows


def _summary_rows(value: Any) -> list[list[Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise AnalysisXlsxError("结果摘要格式无效。")
    rows: list[list[Any]] = []
    for row in value:
        if not isinstance(row, list) or not 2 <= len(row) <= 3:
            raise AnalysisXlsxError("结果摘要格式无效。")
        rows.append([
            _safe_cell_value(row[0]),
            _safe_cell_value(row[1]),
            _safe_cell_value(row[2] if len(row) > 2 else ""),
        ])
    return rows


def _detail_sections(value: Any) -> tuple[list[dict[str, Any]], int]:
    if value is None:
        return [], 0
    if not isinstance(value, list):
        raise AnalysisXlsxError("结果明细格式无效。")
    sections: list[dict[str, Any]] = []
    remaining_rows = MAX_DETAIL_ROWS
    omitted_rows = 0
    for raw_section in value:
        if not isinstance(raw_section, dict):
            raise AnalysisXlsxError("结果明细格式无效。")
        title = _required_text(raw_section.get("title"), "明细标题")
        columns = raw_section.get("columns")
        rows = raw_section.get("rows")
        if not isinstance(columns, list) or not columns or len(columns) > MAX_DETAIL_COLUMNS:
            raise AnalysisXlsxError(f"“{title}”的列定义无效或超过 {MAX_DETAIL_COLUMNS} 列限制。")
        if not isinstance(rows, list):
            raise AnalysisXlsxError(f"“{title}”的明细格式无效。")
        safe_columns = [_safe_cell_value(column) for column in columns]
        safe_rows: list[list[Any]] = []
        accepted = min(len(rows), remaining_rows)
        for row in rows[:accepted]:
            if not isinstance(row, list) or len(row) != len(columns):
                raise AnalysisXlsxError(f"“{title}”的明细列数与表头不一致。")
            safe_rows.append([_safe_cell_value(cell) for cell in row])
        omitted_rows += len(rows) - accepted
        remaining_rows -= accepted
        sections.append({"title": title, "columns": safe_columns, "rows": safe_rows})
    return sections, omitted_rows


def _write_table(sheet, columns: list[Any], rows: list[list[Any]], *, start_row: int = 1) -> int:
    header_fill = PatternFill("solid", fgColor="D9EAF7")
    for column_index, value in enumerate(columns, start=1):
        cell = sheet.cell(row=start_row, column=column_index, value=_safe_cell_value(value))
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    sheet.row_dimensions[start_row].height = max(sheet.row_dimensions[start_row].height or 0, 30)
    for row_index, row in enumerate(rows, start=start_row + 1):
        needs_extra_height = False
        for column_index, value in enumerate(row, start=1):
            cell = sheet.cell(row=row_index, column=column_index, value=_safe_cell_value(value))
            visual_width = _text_display_width(cell.value)
            should_wrap = "\n" in str(cell.value or "") or visual_width > MAX_COLUMN_WIDTH
            cell.alignment = Alignment(vertical="top", wrap_text=should_wrap)
            needs_extra_height = needs_extra_height or should_wrap
        if needs_extra_height:
            sheet.row_dimensions[row_index].height = 45
    sheet.freeze_panes = sheet.freeze_panes or f"A{start_row + 1}"
    _fit_columns(sheet)
    return start_row + len(rows) + 1


def _fit_columns(sheet) -> None:
    for column_index in range(1, sheet.max_column + 1):
        width = max(
            (_text_display_width(sheet.cell(row=row_index, column=column_index).value) for row_index in range(1, sheet.max_row + 1)),
            default=8,
        )
        sheet.column_dimensions[get_column_letter(column_index)].width = min(MAX_COLUMN_WIDTH, max(12, width + 2))


def _text_display_width(value: Any) -> int:
    """Approximate Excel's visible width, counting full-width CJK glyphs twice."""
    lines = str(value or "").expandtabs(4).splitlines() or [""]
    return max(
        sum(
            0
            if unicodedata.combining(character)
            else 2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
            for character in line
        )
        for line in lines
    )


def _safe_cell_value(value: Any) -> str | int | float:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return value
    text = _clean_xml_text(value).strip()[:MAX_CELL_TEXT]
    if text.startswith(_FORMULA_PREFIXES):
        return f"'{text}"
    return text


def _required_text(value: Any, label: str) -> str:
    text = _clean_xml_text(value).strip()
    if not text:
        raise AnalysisXlsxError(f"缺少{label}，无法导出。")
    return text


def _safe_filename_segment(value: Any, fallback: str) -> str:
    text = _UNSAFE_FILENAME.sub("_", _clean_xml_text(value)).strip(" .")
    text = re.sub(r"\s+", " ", text)[:60].strip(" .")
    return text or fallback


def _clean_xml_text(value: Any) -> str:
    return _ILLEGAL_XML_CHARACTERS.sub("", str(value or ""))


def _export_timestamp(value: Any) -> datetime:
    text = str(value or "").strip()
    if text:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)
