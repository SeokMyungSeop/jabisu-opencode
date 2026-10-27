"""행정 문서(보고서·메모보고·회의록·출장결과보고·보도자료)를 한글(.hwpx) 파일로 만든다.

문서 양식 JSON 하나를 받아 관공서 양식(한글 문서 스킬의 government 템플릿)으로 조립하고, 구조를 검증한 뒤
공문서 표기를 검사한다. 양식과 JSON 꼴은 이 스킬의 forms.md에 있다.

    python make_admin_doc.py 문서.json
"""

import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jabisu_python  # noqa: E402,F401  공용 패키지 폴더를 찾고 한글 출력이 깨지지 않게 한다.
import check_style  # noqa: E402

# 자비수가 스킬을 풀 때 기본 스킬 묶음 폴더로 바꿔 넣는다. 이 스킬을 사용자 폴더로 복사해 고쳐 쓸 때 쓴다.
BUNDLES = r"__JABISU_BUNDLES__"


def hwpx_skill():
    """한글 문서 스킬의 폴더: 곁에 있는 것, 없으면 가장 최근 기본 스킬 묶음의 것."""
    candidates = [os.path.join(HERE, "..", "..", "hwpx")]
    if os.path.isdir(BUNDLES):
        bundles = [os.path.join(BUNDLES, name) for name in os.listdir(BUNDLES) if name.startswith("jabisu-")]
        candidates += [os.path.join(bundle, "hwpx") for bundle in sorted(bundles, key=os.path.getmtime, reverse=True)]
    for candidate in candidates:
        if os.path.isfile(os.path.join(candidate, "scripts", "hwpx_helpers.py")):
            return os.path.normpath(candidate)
    sys.exit("한글 문서 스킬(hwpx)을 찾지 못했습니다. 자비수를 다시 시작한 뒤 다시 해 보세요.")


HWPX = hwpx_skill()
sys.path.insert(0, os.path.join(HWPX, "scripts"))
from hwpx_helpers import NS_DECL, extract_secpr_and_colpr, make_first_para, next_id, xml_escape  # noqa: E402

# 본문 폭(HWPUNIT, 1pt = 100). A4에서 좌우 여백을 뺀 폭보다 조금 좁게 둔다.
TEXT_WIDTH = 47624

# government 템플릿의 글자 모양(charPr) 번호.
CHAR = {
    "title": "87",  # 22pt HY헤드라인M
    "memo_title": "17",  # 18pt HY헤드라인M
    "press_banner": "49",  # 24pt HY헤드라인M
    "press_lead": "53",  # 15pt 휴먼명조 굵게
    "heading": "51",  # 16pt HY헤드라인M (Ⅰ. Ⅱ.)
    "l1": "27",  # 15pt HY헤드라인M (□)
    "l2": "64",  # 14pt 휴먼명조 (○)
    "l3": "64",  # 14pt 휴먼명조 (-)
    "l4": "0",  # 13pt 휴먼명조 (·)
    "note": "13",  # 12pt 휴먼명조 (※)
    "plain": "64",  # 14pt 휴먼명조 (보도자료 문단)
    "small": "0",  # 13pt 휴먼명조 (날짜·작성자, 붙임)
    "cell": "13",  # 12pt 휴먼명조
    "cell_head": "43",  # 12pt 휴먼명조 굵게
    "empty": "41",
}

# 표 테두리(borderFill): 가는 실선, 회색 바탕 실선.
BORDER = "4"
BORDER_HEAD = "42"

# 템플릿에 있는 문단 모양(paraPr): 가운데, 오른쪽, 양쪽.
PARA_CENTER = "1"
PARA_RIGHT = "26"
PARA_JUSTIFY = "4"

# 이 스크립트가 템플릿에 더하는 문단 모양: (이름, 정렬, 왼쪽 여백, 들여쓰기(음수는 내어쓰기), 문단 위 간격).
# 내어쓰기 폭은 기호와 띄어쓰기 한 칸의 폭이라, 둘째 줄부터 글 첫머리에 맞춰진다.
ADDED_PARAS = [
    ("heading", "LEFT", 0, 0, 1800),
    ("l1", "JUSTIFY", 0, -2250, 1400),
    ("l2", "JUSTIFY", 1500, -2100, 500),
    ("l3", "JUSTIFY", 3000, -1400, 200),
    ("l4", "JUSTIFY", 4500, -1300, 100),
    ("note", "JUSTIFY", 3000, -1800, 100),
    ("plain", "JUSTIFY", 0, 1400, 500),
    ("lead", "JUSTIFY", 1500, -1500, 100),
    ("attach", "JUSTIFY", 0, -2600, 1400),
]

# 줄 머리 기호와 그 단계.
MARKERS = [
    (re.compile(r"^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.?\s"), "heading"),
    (re.compile(r"^□\s?"), "l1"),
    (re.compile(r"^[○◦]\s?"), "l2"),
    (re.compile(r"^[-–―]\s"), "l3"),
    (re.compile(r"^[·•]\s?"), "l4"),
    (re.compile(r"^※"), "note"),
]

# 양식마다 제목 크기, 개요 표 자리, 보도자료 머리 여부.
FORMS = {
    "보고서": {"title": "title"},
    "결과보고": {"title": "title"},
    "계획": {"title": "title"},
    "메모보고": {"title": "memo_title"},
    "회의록": {"title": "title"},
    "출장결과보고": {"title": "title"},
    "보도자료": {"title": "title", "press": True},
}


def today():
    now = datetime.date.today()
    return f"{now.year}. {now.month}. {now.day}.({'월화수목금토일'[now.weekday()]})"


# --- 헤더: 템플릿에 문단 모양을 더한다 ---


def header_with_paras(source, target):
    """템플릿 header.xml에 ADDED_PARAS를 덧붙여 쓰고, 이름별 문단 모양 번호를 돌려준다."""
    with open(source, encoding="utf-8") as handle:
        header = handle.read()
    count = re.search(r'<hh:paraProperties itemCnt="(\d+)"', header)
    base = re.search(r'<hh:paraPr id="4"[\s\S]*?</hh:paraPr>', header)
    if not count or not base:
        sys.exit("관공서 템플릿의 header.xml 모양이 예상과 다릅니다. 한글 문서 스킬이 바뀌었는지 확인하세요.")
    first = int(count.group(1))
    ids = {}
    added = []
    for offset, (name, align, left, indent, before) in enumerate(ADDED_PARAS):
        pid = str(first + offset)
        ids[name] = pid
        xml = base.group(0).replace('<hh:paraPr id="4"', f'<hh:paraPr id="{pid}"', 1)
        xml = re.sub(r'horizontal="[A-Z]+"', f'horizontal="{align}"', xml, count=1)
        xml = re.sub(r'<hc:intent value="-?\d+"', f'<hc:intent value="{indent}"', xml)
        xml = re.sub(r'<hc:left value="-?\d+"', f'<hc:left value="{left}"', xml)
        xml = re.sub(r'<hc:prev value="-?\d+"', f'<hc:prev value="{before}"', xml)
        added.append(xml)
    header = header.replace(count.group(0), f'<hh:paraProperties itemCnt="{first + len(added)}"', 1)
    header = header.replace("</hh:paraProperties>", "".join(added) + "</hh:paraProperties>", 1)
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(header)
    return ids


# --- 문단과 표 ---


def paragraph(text, char, para, page_break=False):
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{para}" styleIDRef="0" pageBreak="{1 if page_break else 0}" '
        f'columnBreak="0" merged="0"><hp:run charPrIDRef="{char}">'
        + (f"<hp:t>{xml_escape(text)}</hp:t>" if text else "<hp:t/>")
        + "</hp:run></hp:p>"
    )


def empty():
    return paragraph("", CHAR["empty"], "18")


def cell(text, col, row, width, height, head=False, span=1, align=None, char=None):
    """표 칸 하나. 글의 줄바꿈은 칸 안의 문단이 된다."""
    char = char or (CHAR["cell_head"] if head else CHAR["cell"])
    para = align or (PARA_CENTER if head else PARA_JUSTIFY)
    lines = str(text).split("\n") or [""]
    body = "".join(
        f'<hp:p paraPrIDRef="{para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" id="{next_id()}">'
        f'<hp:run charPrIDRef="{char}">'
        + (f"<hp:t>{xml_escape(line)}</hp:t>" if line else "<hp:t/>")
        + "</hp:run></hp:p>"
        for line in lines
    )
    return (
        f'<hp:tc name="" header="{1 if head else 0}" hasMargin="0" protect="0" editable="0" dirty="1" '
        f'borderFillIDRef="{BORDER_HEAD if head else BORDER}">'
        f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" '
        f'linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">{body}</hp:subList>'
        f'<hp:cellAddr colAddr="{col}" rowAddr="{row}"/><hp:cellSpan colSpan="{span}" rowSpan="1"/>'
        f'<hp:cellSz width="{width}" height="{height}"/>'
        f'<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>'
    )


def table(rows, columns, row_height=2100, repeat_header=False):
    """rows: [[(글, 칸 수, 머리칸 여부, 정렬, 글자 모양), …], …], columns: 열 너비 목록."""
    height = row_height * len(rows)
    body = ""
    for r, row in enumerate(rows):
        body += "<hp:tr>"
        col = 0
        for text, span, head, align, char in row:
            width = sum(columns[col : col + span])
            body += cell(text, col, r, width, row_height, head, span, align, char)
            col += span
        body += "</hp:tr>"
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="0"><hp:tbl id="{next_id()}" zOrder="0" numberingType="TABLE" '
        f'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" '
        f'repeatHeader="{1 if repeat_header else 0}" rowCnt="{len(rows)}" colCnt="{len(columns)}" cellSpacing="0" '
        f'borderFillIDRef="{BORDER}" noAdjust="0">'
        f'<hp:sz width="{sum(columns)}" widthRelTo="ABSOLUTE" height="{height}" heightRelTo="ABSOLUTE" protect="0"/>'
        f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
        f'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        f'<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
        f'<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
        f"{body}</hp:tbl></hp:run></hp:p>"
    )


def widths(weights, total=TEXT_WIDTH):
    """비율대로 나눈 열 너비. 합이 정확히 total이 되게 마지막 열에서 맞춘다."""
    parts = [max(1, float(weight)) for weight in weights]
    scale = total / sum(parts)
    columns = [int(part * scale) for part in parts]
    columns[-1] += total - sum(columns)
    return columns


def title_box(title, char):
    return table([[(title, 1, False, PARA_CENTER, char)]], [TEXT_WIDTH], row_height=3800)


def meta_table(meta):
    """개요 표: 왼쪽은 항목 이름, 오른쪽은 내용."""
    rows = [[(label, 1, True, None, None), (str(value), 1, False, None, None)] for label, value in meta.items()]
    return table(rows, widths([1, 4]))


def press_table(meta):
    """보도자료 머리 표: 항목 두 쌍씩 한 줄에 놓는다. 홀수면 마지막 내용 칸을 넓힌다."""
    pairs = list(meta.items())
    rows = []
    for index in range(0, len(pairs), 2):
        chunk = pairs[index : index + 2]
        row = []
        for label, value in chunk:
            last_alone = len(chunk) == 1
            row += [(label, 1, True, None, None), (str(value), 3 if last_alone else 1, False, None, None)]
        rows.append(row)
    return table(rows, widths([1, 2, 1, 2]))


def body_table(item):
    rows = [list(map(str, row)) for row in item.get("table") or []]
    if not rows:
        return ""
    count = max(len(row) for row in rows)
    rows = [row + [""] * (count - len(row)) for row in rows]
    weights = item.get("widths") or [1] * count
    if len(weights) != count:
        sys.exit(f"표의 widths는 열 수({count})만큼 적어야 합니다.")
    shaped = [[(text, 1, index == 0, None, None) for text in row] for index, row in enumerate(rows)]
    return table(shaped, widths(weights), repeat_header=True)


def line(text, paras):
    """기호로 단계를 정해 한 줄을 문단으로 만든다. 기호가 없으면 보통 문단이다."""
    for pattern, level in MARKERS:
        if pattern.match(text):
            return paragraph(text, CHAR[level], paras[level])
    return paragraph(text, CHAR["plain"], paras["plain"])


def attachments(items, paras):
    if not items:
        return []
    if len(items) == 1:
        return [paragraph(f"붙임  {items[0]}", CHAR["small"], paras["attach"])]
    rows = [paragraph(f"붙임  1. {items[0]}", CHAR["small"], paras["attach"])]
    rows += [paragraph(f"      {index}. {item}", CHAR["small"], paras["l3"]) for index, item in enumerate(items[1:], start=2)]
    return rows


# --- 문서 ---


def section(spec, paras):
    form = FORMS[spec["form"]]
    secpr, colpr = extract_secpr_and_colpr(os.path.join(HWPX, "assets", "government-reference.hwpx"))
    meta = spec.get("meta") or {}
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
        f"<hs:sec {NS_DECL}>",
        make_first_para(secpr, colpr),
    ]
    if form.get("press"):
        if spec.get("agency"):
            parts.append(paragraph(spec["agency"], CHAR["small"], PARA_CENTER))
        parts.append(paragraph("보 도 자 료", CHAR["press_banner"], PARA_CENTER))
        parts.append(empty())
        if meta:
            parts.append(press_table(meta))
        parts.append(empty())
        parts.append(paragraph(spec["title"], CHAR["title"], "20"))
        for lead in spec.get("lead") or []:
            parts.append(paragraph(lead, CHAR["press_lead"], paras["lead"]))
        parts.append(empty())
    else:
        parts.append(title_box(spec["title"], CHAR[form["title"]]))
        stamp = "  ".join(value for value in (spec.get("date") or today(), spec.get("author") or "") if value)
        parts.append(paragraph(stamp, CHAR["small"], PARA_RIGHT))
        if meta:
            parts.append(meta_table(meta))
    for item in spec.get("body") or []:
        if isinstance(item, dict):
            parts.append(body_table(item))
        elif str(item).strip():
            parts.append(line(str(item).strip(), paras))
        else:
            parts.append(empty())
    parts.extend(attachments(spec.get("attachments") or [], paras))
    parts.append("</hs:sec>")
    return "\n".join(parts)


def load(path):
    with open(path, encoding="utf-8") as handle:
        spec = json.load(handle)
    if spec.get("form") not in FORMS:
        sys.exit(f"form은 다음 가운데 하나여야 합니다: {', '.join(FORMS)}")
    if not str(spec.get("title") or "").strip():
        sys.exit("title(제목)이 필요합니다.")
    meta = spec.get("meta")
    if meta is not None and not isinstance(meta, dict):
        sys.exit('meta는 {"항목": "내용"} 꼴이어야 합니다.')
    return spec


def output_path(spec, source):
    if spec.get("output"):
        return os.path.abspath(spec["output"])
    name = re.sub(r'[\\/:*?"<>|]+', " ", spec["title"]).strip()[:60] or "문서"
    return os.path.join(os.path.dirname(os.path.abspath(source)), f"{name}.hwpx")


def run(script, *arguments):
    result = subprocess.run(
        [sys.executable, os.path.join(HWPX, "scripts", script), *map(str, arguments)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        sys.exit(f"{script} 실패:\n{result.stdout}{result.stderr}")
    return result.stdout


def main(arguments):
    if len(arguments) != 1:
        print(__doc__)
        return 2
    absent = jabisu_python.missing(["lxml"])
    if absent:
        helper = os.path.join(HERE, "jabisu_python.py")
        sys.exit(
            f"Python 패키지가 없습니다: {', '.join(absent)}. 사용자에게 묻고 허락받은 뒤 설치하세요: "
            f'python "{helper}" install {" ".join(absent)}'
        )
    spec = load(arguments[0])
    target = output_path(spec, arguments[0])
    work = tempfile.mkdtemp(prefix="jabisu-admin-doc-")
    try:
        header = os.path.join(work, "header.xml")
        paras = header_with_paras(os.path.join(HWPX, "templates", "government", "header.xml"), header)
        content = os.path.join(work, "section0.xml")
        with open(content, "w", encoding="utf-8") as handle:
            handle.write(section(spec, paras))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        run("build_hwpx.py", "--header", header, "--section", content, "--title", spec["title"], "--output", target)
        run("fix_namespaces.py", target)
        checked = run("validate.py", target)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"만들었습니다: {target}")
    print("구조 검증: " + ("통과" if "VALID" in checked else checked.strip()))
    lines = list(check_style.spec_lines(spec))
    print(check_style.report(check_style.check(lines)))
    unsure = sum(text.count("확인 필요") for text in lines)
    if unsure:
        print(f"(확인 필요) 표시: {unsure}곳 — 사용자에게 확인할 목록으로 알려 주세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
