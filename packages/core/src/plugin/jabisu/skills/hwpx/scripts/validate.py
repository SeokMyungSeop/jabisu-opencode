#!/usr/bin/env python3
"""Validate the structural integrity of an HWPX file.

Checks:
  - Valid ZIP archive
  - Required files present (mimetype, content.hpf, header.xml, section0.xml)
  - mimetype content is correct
  - mimetype is the first ZIP entry and stored without compression
  - All XML files are well-formed
  - Every table declares rowCnt and colCnt that match its rows and cell addresses (Hancom Office
    refuses to open a document otherwise)

Usage:
    python validate.py document.hwpx
"""

# 자비수: 문서 스킬이 함께 쓰는 Python 패키지 폴더를 먼저 찾는다(scripts/jabisu_python.py).
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import jabisu_python  # noqa: E402,F401

import argparse
import sys
from pathlib import Path
from zipfile import ZIP_STORED, BadZipFile, ZipFile

from lxml import etree

REQUIRED_FILES = [
    "mimetype",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
]

EXPECTED_MIMETYPE = "application/hwp+zip"


def validate(hwpx_path: str) -> list[str]:
    """Validate HWPX file and return a list of error messages (empty = valid)."""

    errors: list[str] = []
    path = Path(hwpx_path)

    if not path.is_file():
        return [f"File not found: {hwpx_path}"]

    # Check valid ZIP
    try:
        zf = ZipFile(hwpx_path, "r")
    except BadZipFile:
        return [f"Not a valid ZIP archive: {hwpx_path}"]

    with zf:
        names = zf.namelist()

        # Check required files
        for required in REQUIRED_FILES:
            if required not in names:
                errors.append(f"Missing required file: {required}")

        # Check mimetype content
        if "mimetype" in names:
            mimetype_content = zf.read("mimetype").decode("utf-8").strip()
            if mimetype_content != EXPECTED_MIMETYPE:
                errors.append(
                    f"Invalid mimetype: expected '{EXPECTED_MIMETYPE}', "
                    f"got '{mimetype_content}'"
                )

            # Check mimetype is first entry
            if names[0] != "mimetype":
                errors.append(
                    f"mimetype is not the first ZIP entry (found at index "
                    f"{names.index('mimetype')})"
                )

            # Check mimetype is stored without compression
            info = zf.getinfo("mimetype")
            if info.compress_type != ZIP_STORED:
                errors.append(
                    f"mimetype should use ZIP_STORED (0), "
                    f"got compress_type={info.compress_type}"
                )

        # Check XML well-formedness
        for name in names:
            if name.endswith(".xml") or name.endswith(".hpf"):
                try:
                    data = zf.read(name)
                    etree.fromstring(data)
                except etree.XMLSyntaxError as e:
                    errors.append(f"Malformed XML in {name}: {e}")
                    continue
                if name.startswith("Contents/section"):
                    errors.extend(check_tables(name, etree.fromstring(data)))

    return errors


HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def check_tables(name: str, root) -> list[str]:
    """자비수: Hancom Office needs each table's rowCnt and colCnt, and cells inside them."""
    errors: list[str] = []
    for number, table in enumerate(root.iter(f"{HP}tbl"), start=1):
        where = f"{name}: table {number} (id {table.get('id')})"
        rows = table.findall(f"{HP}tr")
        if table.get("rowCnt") is None or table.get("colCnt") is None:
            errors.append(f"{where} lacks rowCnt/colCnt; add rowCnt=\"{len(rows)}\" and colCnt to <hp:tbl>")
            continue
        row_count, col_count = int(table.get("rowCnt")), int(table.get("colCnt"))
        if row_count != len(rows):
            errors.append(f"{where} has rowCnt={row_count} but {len(rows)} <hp:tr> rows")
        for row in rows:
            for cell in row.findall(f"{HP}tc"):
                address = cell.find(f"{HP}cellAddr")
                if address is None or cell.find(f"{HP}cellSpan") is None or cell.find(f"{HP}cellSz") is None:
                    errors.append(f"{where} has a cell without cellAddr, cellSpan or cellSz")
                    continue
                if int(address.get("colAddr", 0)) >= col_count or int(address.get("rowAddr", 0)) >= row_count:
                    errors.append(f"{where} has a cell at {address.get('colAddr')},{address.get('rowAddr')} outside its {col_count}x{row_count} grid")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate the structural integrity of an HWPX file"
    )
    parser.add_argument("input", help="Path to .hwpx file")
    args = parser.parse_args()

    errors = validate(args.input)

    if errors:
        print(f"INVALID: {args.input}", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"VALID: {args.input}")
        print(f"  All structural checks passed.")


if __name__ == "__main__":
    main()
