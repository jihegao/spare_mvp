"""OOXML text serialization shared by exports, independent of the lxml engine."""
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED


def workbook_bytes(workbook) -> bytes:
    raw = BytesIO()
    workbook.save(raw)
    output = BytesIO()
    with ZipFile(raw) as source, ZipFile(output, 'w', ZIP_DEFLATED) as target:
        for entry in source.infolist():
            content = source.read(entry.filename)
            if entry.filename.endswith('.xml'):
                # XML parsers normalize literal CR. Character references preserve it.
                content = content.replace(b'\r', b'&#13;')
            target.writestr(entry, content)
    return output.getvalue()
