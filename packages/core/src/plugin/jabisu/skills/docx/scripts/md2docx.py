#!/usr/bin/env python3
"""마크다운을 워드(.docx) 문서로 바꾼다.

사용법:
    python md2docx.py 입력.md 출력.docx [--font "맑은 고딕"] [--size 11] [--margin 25]

지원하는 마크다운:
    # ~ ######        제목 1~6
    문단               빈 줄로 나눈다. 줄 끝 공백 두 칸이나 \\ 는 줄바꿈
    **굵게** *기울임* `코드` [글](주소)
    - 항목 / 1. 항목   글머리표·번호 목록 (두 칸 들여쓰면 한 단계 아래, 최대 3단계)
    | 머리 | 머리 |     표 (둘째 줄 |---|:---:|---:| 로 왼쪽·가운데·오른쪽 정렬, 칸 안 <br> 은 줄바꿈)
    > 인용             인용 문단
    ```                코드 블록
    ![설명](그림.png)  그림 (본문 너비에 맞추고 설명을 아래에 단다)
    ---                가로줄
    <!-- pagebreak --> 쪽 나누기
"""

# 자비수: 문서 스킬이 함께 쓰는 Python 패키지 폴더를 먼저 찾는다(scripts/jabisu_python.py).
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import jabisu_python  # noqa: E402,F401

import argparse
import os
import re
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

INLINE = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)")
LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
ALIGN = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT}
HEADING_SIZES = {1: 16, 2: 14, 3: 13, 4: 12, 5: 11, 6: 11}
CODE_FONT = "Consolas"


def main():
    parser = argparse.ArgumentParser(description="마크다운을 워드(.docx) 문서로 바꾼다.")
    parser.add_argument("input", help="마크다운 파일")
    parser.add_argument("output", help="만들 .docx 파일")
    parser.add_argument("--font", default="맑은 고딕", help="본문 글꼴 (기본: 맑은 고딕)")
    parser.add_argument("--size", type=float, default=11, help="본문 글자 크기 pt (기본: 11)")
    parser.add_argument("--margin", type=float, default=25, help="쪽 여백 mm (기본: 25)")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8-sig") as file:
        lines = file.read().splitlines()
    document = Document()
    setup(document, args.font, args.size, args.margin)
    counts = convert(document, lines, os.path.dirname(os.path.abspath(args.input)), args.font)
    document.save(args.output)
    print(f"만들었습니다: {args.output} (문단 {counts['paragraphs']}개, 표 {counts['tables']}개, 그림 {counts['images']}개)")


def setup(document, font, size, margin):
    section = document.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(section, side, Mm(margin))
    normal = document.styles["Normal"]
    normal.font.size = Pt(size)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.3
    names = ["Normal", "Title", "Quote", "List Bullet", "List Bullet 2", "List Bullet 3"]
    names += [f"Heading {level}" for level in range(1, 7)]
    for name in names:
        style = document.styles[name]
        set_fonts(style.element, font)
        if name.startswith("Heading"):
            level = int(name.split()[-1])
            style.font.size = Pt(HEADING_SIZES[level])
            style.font.bold = True
            style.font.italic = False
            style.font.color.rgb = RGBColor(0, 0, 0)
            style.paragraph_format.space_before = Pt(12 if level <= 2 else 8)
            style.paragraph_format.space_after = Pt(6)


def set_fonts(element, font):
    """글꼴을 영문·한글 모두에 지정한다. 테마 글꼴 지정이 있으면 그것이 이기므로 지운다."""
    fonts = element.get_or_add_rPr().get_or_add_rFonts()
    for name in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        fonts.attrib.pop(qn(name), None)
    for name in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        fonts.set(qn(name), font)


def convert(document, lines, base, font):
    counts = {"paragraphs": 0, "tables": 0, "images": 0}
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            index += 1
            continue
        if stripped.startswith("```"):
            end = next((i for i in range(index + 1, len(lines)) if lines[i].strip().startswith("```")), len(lines))
            code(document, lines[index + 1 : end])
            counts["paragraphs"] += 1
            index = end + 1
            continue
        if stripped.lower().replace(" ", "") == "<!--pagebreak-->":
            document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
            index += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            inline(document.add_heading(level=len(heading.group(1))), heading.group(2).strip().rstrip("#").strip(), font)
            counts["paragraphs"] += 1
            index += 1
            continue
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            rule(document.add_paragraph())
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and separator(lines[index + 1]):
            end = index + 2
            while end < len(lines) and lines[end].strip().startswith("|"):
                end += 1
            table(document, lines[index:end], font)
            counts["tables"] += 1
            index = end
            continue
        image = re.fullmatch(r"!\[(.*?)\]\((.+?)\)", stripped)
        if image:
            picture(document, image.group(1), image.group(2), base)
            counts["images"] += 1
            index += 1
            continue
        item = LIST.match(line)
        if item:
            level = min(len(item.group(1).replace("\t", "  ")) // 2, 2)
            marker = item.group(2)
            if marker[0].isdigit():
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.left_indent = Mm(6 + level * 6)
                paragraph.paragraph_format.first_line_indent = Mm(-6)
                paragraph.add_run(marker.rstrip(".)") + ". ")
            else:
                paragraph = document.add_paragraph(style="List Bullet" + ("" if level == 0 else f" {level + 1}"))
            inline(paragraph, item.group(3), font)
            counts["paragraphs"] += 1
            index += 1
            continue
        if stripped.startswith(">"):
            end = index
            while end < len(lines) and lines[end].strip().startswith(">"):
                end += 1
            quote = [lines[i].strip()[1:].strip() for i in range(index, end)]
            inline(document.add_paragraph(style="Quote"), "  \n".join(quote), font)
            counts["paragraphs"] += 1
            index = end
            continue
        end = index
        while end < len(lines) and lines[end].strip() and not special(lines, end):
            end += 1
        end = max(end, index + 1)
        inline(document.add_paragraph(), "\n".join(lines[index:end]), font)
        counts["paragraphs"] += 1
        index = end
    return counts


def special(lines, index):
    stripped = lines[index].strip()
    return bool(
        re.match(r"^(#{1,6}\s|```|>|!\[|\|)", stripped)
        or LIST.match(lines[index])
        or re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped)
    )


def inline(paragraph, text, font):
    """줄 끝 공백 두 칸이나 \\ 는 줄바꿈, 그 밖의 줄바꿈은 띄어쓰기로 이어 붙인다."""
    parts = re.split(r"(?:  |\\)\n", text)
    for number, part in enumerate(parts):
        if number > 0:
            paragraph.add_run().add_break()
        runs(paragraph, re.sub(r"\s*\n\s*", " ", part), font)


def runs(paragraph, text, font):
    position = 0
    for match in INLINE.finditer(text):
        if match.start() > position:
            paragraph.add_run(text[position : match.start()])
        if match.group(1) is not None:
            paragraph.add_run(match.group(1)).bold = True
        elif match.group(2) is not None:
            paragraph.add_run(match.group(2)).italic = True
        elif match.group(3) is not None:
            run = paragraph.add_run(match.group(3))
            run.font.name = CODE_FONT
        else:
            link(paragraph, match.group(4), match.group(5))
        position = match.end()
    if position < len(text):
        paragraph.add_run(text[position:])


def link(paragraph, text, url):
    relationship = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship)
    run = paragraph.add_run(text)
    run.font.color.rgb = RGBColor(0x05, 0x63, 0xC1)
    run.font.underline = True
    hyperlink.append(run._r)
    paragraph._p.append(hyperlink)


def code(document, lines):
    paragraph = document.add_paragraph()
    # 워드는 문단 속성의 순서를 따지므로, 음영을 들여쓰기보다 먼저 넣는다.
    shade(paragraph._p.get_or_add_pPr(), "F2F2F2")
    paragraph.paragraph_format.left_indent = Mm(4)
    for number, line in enumerate(lines):
        if number > 0:
            paragraph.add_run().add_break()
        run = paragraph.add_run(line)
        run.font.name = CODE_FONT
        run.font.size = Pt(9.5)


def rule(paragraph):
    border = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    for key, value in {"w:val": "single", "w:sz": "6", "w:space": "1", "w:color": "999999"}.items():
        bottom.set(qn(key), value)
    border.append(bottom)
    paragraph._p.get_or_add_pPr().append(border)


def separator(line):
    cells = row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def row(line):
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith("\\|"):
        stripped = stripped[:-1]
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", stripped)]


def table(document, lines, font):
    header = row(lines[0])
    aligns = [
        "center" if cell.startswith(":") and cell.endswith(":") else "right" if cell.endswith(":") else "left"
        for cell in (part.replace(" ", "") for part in row(lines[1]))
    ]
    body = [row(line) for line in lines[2:]]
    width = max(len(header), *(len(cells) for cells in body)) if body else len(header)
    grid = document.add_table(rows=1 + len(body), cols=width)
    grid.style = "Table Grid"
    for row_index, cells in enumerate([header, *body]):
        for column in range(width):
            cell = grid.cell(row_index, column)
            paragraph = cell.paragraphs[0]
            paragraph.alignment = ALIGN[aligns[column] if column < len(aligns) else "left"]
            paragraph.paragraph_format.space_after = Pt(0)
            inline(paragraph, re.sub(r"<br\s*/?>", "  \n", cells[column] if column < len(cells) else ""), font)
            if row_index == 0:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in paragraph.runs:
                    run.bold = True
                shade(cell._tc.get_or_add_tcPr(), "D9D9D9")
    # 머리 줄이 다음 쪽에서도 다시 나오게 한다.
    header_row = grid.rows[0]._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    header_row.append(repeat)
    document.add_paragraph()


def shade(properties, fill):
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), fill)
    properties.append(shading)


def picture(document, caption, source, base):
    file = source if os.path.isabs(source) else os.path.join(base, source)
    if not os.path.isfile(file):
        document.add_paragraph(f"[그림을 찾을 수 없습니다: {source}]")
        print(f"경고: 그림을 찾을 수 없습니다: {file}", file=sys.stderr)
        return
    section = document.sections[0]
    usable = section.page_width - section.left_margin - section.right_margin
    shape = document.add_picture(file)
    # 원래 크기로 넣고, 본문보다 넓을 때만 비율을 지켜 줄인다.
    if shape.width > usable:
        shape.height = int(shape.height * usable / shape.width)
        shape.width = usable
    document.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    if caption:
        paragraph = document.add_paragraph(caption)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in paragraph.runs:
            run.italic = True
            run.font.size = Pt(9)


if __name__ == "__main__":
    main()
