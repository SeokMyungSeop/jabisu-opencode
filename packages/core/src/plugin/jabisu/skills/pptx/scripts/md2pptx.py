#!/usr/bin/env python3
"""마크다운 개요를 파워포인트(.pptx) 발표 자료로 바꾼다.

사용법:
    python md2pptx.py 입력.md 출력.pptx [--font "맑은 고딕"] [--standard]

규칙:
    # 제목              표지. 다음 줄들은 부제목
    ## 슬라이드 제목     새 슬라이드
    ### 소제목          슬라이드 안의 굵은 줄
    - 항목 / 1. 항목     글머리 기호·번호 (두 칸 들여쓰면 한 단계 아래, 최대 5단계)
    일반 문단            글머리 기호 없는 본문
    **굵게** *기울임* `코드` [글](주소)
    | 표 |              표 (둘째 줄 |---|:---:|---:| 로 정렬)
    ![설명](그림.png)    그림 (남은 자리에 비율을 지켜 맞춘다. 경로는 마크다운 파일 기준)
    > 메모               발표자 메모
기본은 16:9 와이드 화면이다. --standard 는 4:3.
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

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

INLINE = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)")
LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
ALIGN = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}
MARGIN = Inches(0.6)
TITLE_COLOR = RGBColor(0x1F, 0x38, 0x64)
ACCENT_COLOR = RGBColor(0x2F, 0x55, 0x97)


def main():
    parser = argparse.ArgumentParser(description="마크다운 개요를 파워포인트(.pptx) 발표 자료로 바꾼다.")
    parser.add_argument("input", help="마크다운 파일")
    parser.add_argument("output", help="만들 .pptx 파일")
    parser.add_argument("--font", default="맑은 고딕", help="글꼴 (기본: 맑은 고딕)")
    parser.add_argument("--standard", action="store_true", help="4:3 화면 (기본은 16:9)")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8-sig") as file:
        slides = parse(file.read().splitlines())
    presentation = Presentation()
    if not args.standard:
        presentation.slide_width, presentation.slide_height = Inches(13.333), Inches(7.5)
    base = os.path.dirname(os.path.abspath(args.input))
    for slide in slides:
        render(presentation, slide, args.font, base)
    presentation.save(args.output)
    print(f"만들었습니다: {args.output} (슬라이드 {len(slides)}장)")


def parse(lines):
    slides = []
    current = None
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        index += 1
        if not stripped or re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if heading and len(heading.group(1)) <= 2:
            current = {"kind": "cover" if len(heading.group(1)) == 1 else "content", "title": heading.group(2).strip(), "blocks": [], "notes": []}
            slides.append(current)
            continue
        if current is None:
            current = {"kind": "content", "title": "", "blocks": [], "notes": []}
            slides.append(current)
        if stripped.startswith(">"):
            current["notes"].append(stripped[1:].strip())
        elif heading:
            current["blocks"].append({"type": "text", "level": 0, "text": f"**{heading.group(2).strip()}**", "marker": None})
        elif stripped.startswith("```"):
            end = next((i for i in range(index, len(lines)) if lines[i].strip().startswith("```")), len(lines))
            for code in lines[index:end]:
                current["blocks"].append({"type": "text", "level": 0, "text": f"`{code}`" if code.strip() else "", "marker": None})
            index = end + 1
        elif stripped.startswith("|") and index < len(lines) and separator(lines[index]):
            end = index + 1
            while end < len(lines) and lines[end].strip().startswith("|"):
                end += 1
            aligns = [
                "center" if cell.startswith(":") and cell.endswith(":") else "right" if cell.endswith(":") else "left"
                for cell in (part.replace(" ", "") for part in row(lines[index]))
            ]
            current["blocks"].append({"type": "table", "rows": [row(line)] + [row(item) for item in lines[index + 1 : end]], "aligns": aligns})
            index = end
        elif re.fullmatch(r"!\[(.*?)\]\((.+?)\)", stripped):
            image = re.fullmatch(r"!\[(.*?)\]\((.+?)\)", stripped)
            current["blocks"].append({"type": "image", "alt": image.group(1), "path": image.group(2)})
        else:
            item = LIST.match(line)
            if item:
                level = min(len(item.group(1).replace("\t", "  ")) // 2, 4)
                marker = "number" if item.group(2)[0].isdigit() else "bullet"
                current["blocks"].append({"type": "text", "level": level, "text": item.group(3), "marker": marker})
            else:
                kind = "subtitle" if current["kind"] == "cover" else "text"
                current["blocks"].append({"type": kind, "level": 0, "text": stripped, "marker": None})
    return slides


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


def render(presentation, slide_data, font, base):
    width, height = presentation.slide_width, presentation.slide_height
    if slide_data["kind"] == "cover":
        slide = presentation.slides.add_slide(presentation.slide_layouts[0])
        title, subtitle = slide.placeholders[0], slide.placeholders[1]
        place(title, Inches(1), int(height * 0.28), width - Inches(2), Inches(1.5))
        place(subtitle, Inches(1), int(height * 0.28) + Inches(1.7), width - Inches(2), Inches(1.6))
        write(title.text_frame, [{"level": 0, "text": slide_data["title"], "marker": None}], font, Pt(40), bullets=False)
        for run in title.text_frame.paragraphs[0].runs:
            run.font.bold = True
            run.font.color.rgb = TITLE_COLOR
        lines = [block for block in slide_data["blocks"] if block["type"] in ("subtitle", "text")]
        if lines:
            write(subtitle.text_frame, lines, font, Pt(20), bullets=False)
        else:
            remove(subtitle)
        notes(slide, slide_data["notes"])
        return
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    title, body = slide.placeholders[0], slide.placeholders[1]
    place(title, MARGIN, Inches(0.35), width - 2 * MARGIN, Inches(0.95))
    if slide_data["title"]:
        write(title.text_frame, [{"level": 0, "text": slide_data["title"], "marker": None}], font, Pt(30), bullets=False)
        title.text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT
        for run in title.text_frame.paragraphs[0].runs:
            run.font.bold = True
            run.font.color.rgb = TITLE_COLOR
        # 제목 아래 강조선
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, MARGIN, Inches(1.32), width - 2 * MARGIN, Inches(0.04))
        line.fill.solid()
        line.fill.fore_color.rgb = ACCENT_COLOR
        line.line.fill.background()
    else:
        remove(title)
    texts = [block for block in slide_data["blocks"] if block["type"] == "text"]
    visuals = [block for block in slide_data["blocks"] if block["type"] in ("table", "image")]
    top, bottom = Inches(1.5), height - Inches(0.5)
    size = Pt(24 if len(texts) <= 5 else 20 if len(texts) <= 8 else 16 if len(texts) <= 12 else 14)
    if texts:
        # 그림이나 표가 함께 있으면 글은 위쪽에 필요한 만큼만 차지한다.
        text_height = bottom - top if not visuals else min(int((bottom - top) * 0.45), int(len(texts) * size * 1.6) + Inches(0.3))
        place(body, MARGIN, top, width - 2 * MARGIN, text_height)
        write(body.text_frame, texts, font, size, bullets=True)
        top += text_height + Inches(0.15)
    else:
        remove(body)
    if visuals:
        share = int((bottom - top) / len(visuals))
        for number, visual in enumerate(visuals):
            box = (MARGIN, top + share * number, width - 2 * MARGIN, share - Inches(0.1))
            if visual["type"] == "table":
                table(slide, visual, font, *box)
            else:
                picture(slide, visual, base, *box)
    notes(slide, slide_data["notes"])


def place(shape, left, top, width, height):
    shape.left, shape.top, shape.width, shape.height = int(left), int(top), int(width), int(height)


def remove(shape):
    shape.element.getparent().remove(shape.element)


def write(frame, blocks, font, size, bullets):
    frame.clear()
    frame.word_wrap = True
    for number, block in enumerate(blocks):
        paragraph = frame.paragraphs[0] if number == 0 else frame.add_paragraph()
        paragraph.level = block["level"]
        properties = paragraph._p.get_or_add_pPr()
        if not bullets or block["marker"] is None:
            properties.insert(0, properties.makeelement(qn("a:buNone"), {}))
        elif block["marker"] == "number":
            properties.insert(0, properties.makeelement(qn("a:buAutoNum"), {"type": "arabicPeriod"}))
        runs(paragraph, block["text"], font, Pt(max(size.pt - 2 * block["level"], 12)))


def runs(paragraph, text, font, size):
    position = 0
    pieces = []
    for match in INLINE.finditer(text):
        if match.start() > position:
            pieces.append((text[position : match.start()], {}))
        if match.group(1) is not None:
            pieces.append((match.group(1), {"bold": True}))
        elif match.group(2) is not None:
            pieces.append((match.group(2), {"italic": True}))
        elif match.group(3) is not None:
            pieces.append((match.group(3), {"code": True}))
        else:
            pieces.append((match.group(4), {"link": match.group(5)}))
        position = match.end()
    if position < len(text) or not pieces:
        pieces.append((text[position:], {}))
    for content, style in pieces:
        run = paragraph.add_run()
        run.text = content
        run.font.size = size
        set_font(run, "Consolas" if style.get("code") else font)
        if style.get("bold"):
            run.font.bold = True
        if style.get("italic"):
            run.font.italic = True
        if style.get("link"):
            run.hyperlink.address = style["link"]


def set_font(run, font):
    """글꼴을 영문(latin)과 한글(ea) 모두에 지정한다. python-pptx의 font.name은 영문에만 들어간다."""
    run.font.name = font
    properties = run.font._rPr
    latin = properties.find(qn("a:latin"))
    east = properties.find(qn("a:ea"))
    if east is None:
        east = properties.makeelement(qn("a:ea"), {})
        latin.addnext(east)
    east.set("typeface", font)


def table(slide, data, font, left, top, width, height):
    rows = data["rows"]
    columns = max(len(cells) for cells in rows)
    row_height = min(int(height / len(rows)), Inches(0.6))
    shape = slide.shapes.add_table(len(rows), columns, int(left), int(top), int(width), row_height * len(rows))
    size = Pt(18 if len(rows) <= 6 else 14 if len(rows) <= 10 else 11)
    for row_index, cells in enumerate(rows):
        shape.table.rows[row_index].height = row_height
        for column in range(columns):
            frame = shape.table.cell(row_index, column).text_frame
            frame.clear()
            text = cells[column] if column < len(cells) else ""
            for number, part in enumerate(re.split(r"<br\s*/?>", text)):
                paragraph = frame.paragraphs[0] if number == 0 else frame.add_paragraph()
                paragraph.alignment = PP_ALIGN.CENTER if row_index == 0 else ALIGN[data["aligns"][column] if column < len(data["aligns"]) else "left"]
                runs(paragraph, f"**{part}**" if row_index == 0 and part else part, font, size)


def picture(slide, data, base, left, top, width, height):
    file = data["path"] if os.path.isabs(data["path"]) else os.path.join(base, data["path"])
    if not os.path.isfile(file):
        box = slide.shapes.add_textbox(int(left), int(top), int(width), Inches(0.6))
        box.text_frame.text = f"[그림을 찾을 수 없습니다: {data['path']}]"
        print(f"경고: 그림을 찾을 수 없습니다: {file}", file=sys.stderr)
        return
    with Image.open(file) as image:
        ratio = image.width / image.height
    fit_width = min(int(width), int(height * ratio))
    fit_height = int(fit_width / ratio)
    slide.shapes.add_picture(file, int(left + (width - fit_width) / 2), int(top), Emu(fit_width), Emu(fit_height))


def notes(slide, lines):
    if lines:
        slide.notes_slide.notes_text_frame.text = "\n".join(lines)


if __name__ == "__main__":
    main()
