"""OOXML text serialization shared by exports, independent of the lxml engine."""
from io import BytesIO
from datetime import datetime, timezone
from zipfile import ZipFile, ZIP_DEFLATED

from openpyxl.drawing.spreadsheet_drawing import SpreadsheetDrawing
from openpyxl.worksheet._writer import WorksheetWriter
from openpyxl.writer.excel import ExcelWriter


class _BinaryWorksheetExcelWriter(ExcelWriter):
    """Keep et_xmlfile away from platform text-mode temporary files.

    et_xmlfile opens filename outputs with newline=None, which inserts a CR
    before every LF on Windows. Its binary-stream path disables translation.
    This writer is local to one export; no openpyxl globals are patched.
    """

    def write_worksheet(self, ws):
        ws._drawing = SpreadsheetDrawing()
        ws._drawing.charts = ws._charts
        ws._drawing.images = ws._images
        stream = BytesIO()
        writer = WorksheetWriter(ws, out=stream)
        try:
            writer.write()
        finally:
            writer.close()
        ws._rels = writer._rels
        self._archive.writestr(ws.path[1:], stream.getvalue())
        self.manifest.append(ws)


def workbook_bytes(workbook) -> bytes:
    if workbook.write_only:
        raise ValueError("workbook_bytes requires a normal workbook for lossless text export")
    raw = BytesIO()
    workbook.properties.modified = datetime.now(timezone.utc).replace(tzinfo=None)
    with ZipFile(raw, 'w', ZIP_DEFLATED, allowZip64=True) as archive:
        _BinaryWorksheetExcelWriter(workbook, archive).write_data()
    output = BytesIO()
    with ZipFile(raw) as source, ZipFile(output, 'w', ZIP_DEFLATED) as target:
        for entry in source.infolist():
            content = source.read(entry.filename)
            if entry.filename.endswith('.xml'):
                # XML parsers normalize literal CR. Character references preserve it.
                content = content.replace(b'\r', b'&#13;')
            target.writestr(entry, content)
    return output.getvalue()
