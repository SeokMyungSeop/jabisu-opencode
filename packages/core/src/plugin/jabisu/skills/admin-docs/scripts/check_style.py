"""행정 문서의 표기를 검사한다.

날짜·시간·금액 표기, 법령 이름의 낫표, 순화 대상 행정 용어처럼 규칙으로 가릴 수 있는 것만 찾는다.
고칠지는 글쓴이가 정한다. 문서 양식 JSON, 텍스트, .hwpx를 읽는다.

    python check_style.py 보고서.json
    python check_style.py 보도자료.hwpx
"""

import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jabisu_python  # noqa: E402,F401  한글 출력이 깨지지 않게 한다.

WEEKDAYS = "월화수목금토일"

# 공문서 작성법: 날짜는 "2026. 10. 28.", 시간은 24시각제 "15:30".
DATE_RULES = [
    (re.compile(r"(?<![\d.])(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\d])\.?"), "날짜는 '{y}. {m}. {d}.'처럼 씁니다"),
    (re.compile(r"(?<![\d])(\d{4})\.\s(\d{1,2})\.\s(\d{1,2})(?![\d.])"), "날짜 끝에도 마침표를 찍습니다: '{y}. {m}. {d}.'"),
    (re.compile(r"(?<![\d])(\d{4})\.\s(0\d|\d{1,2})\.\s(0\d)\.|(?<![\d])(\d{4})\.\s(0\d)\.\s(\d{1,2})\."), "월·일의 앞자리 0은 쓰지 않습니다: '{y}. {m}. {d}.'"),
]

TIME_RULE = re.compile(r"(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?")

MONEY_RULE = re.compile(r"(?<![\d,])(\d{5,})\s*원")

# 「」 없이 쓴 법령 이름. "이 법", "같은 법"은 빼고, 이미 「」 안에 있는 것도 뺀다.
LAW_RULE = re.compile(r"(?<![「\w])([가-힣][가-힣ㆍ·\s]{1,40}?(?:법률|법|시행령|시행규칙|조례))\s*제\s*\d+\s*조")

# 행정안전부·국립국어원이 다듬어 쓰기를 권하는 행정 용어 가운데 자주 보이는 것: (찾는 꼴, 보이는 말, 권하는 말).
WORD_RULES = [
    (re.compile(pattern), word, better)
    for pattern, word, better in [
        (r"익일", "익일", "다음 날"),
        (r"금일", "금일", "오늘"),
        (r"명일", "명일", "내일"),
        (r"상기\s", "상기", "위"),
        (r"당해\s", "당해", "해당, 그"),
        (r"의거", "의거", "따라"),
        (r"구비\s?서류", "구비서류", "갖춤 서류"),
        (r"시건\s?장치", "시건장치", "잠금장치"),
        (r"적의\s?조치", "적의 조치", "알맞게 조치"),
        (r"만전을\s?기", "만전을 기하다", "빈틈없이 하다"),
        (r"기\s송부", "기 송부", "이미 보낸"),
        (r"에\s?있어서", "~에 있어서", "~에서"),
    ]
]


def lines_of(path):
    """검사할 글을 줄 단위로 읽는다."""
    if path.lower().endswith(".hwpx"):
        with zipfile.ZipFile(path) as archive:
            names = sorted(name for name in archive.namelist() if re.match(r"Contents/section\d+\.xml$", name))
            lines = []
            for name in names:
                xml = archive.read(name).decode("utf-8", errors="replace")
                for chunk in xml.split("</hp:p>"):
                    text = "".join(re.findall(r"<hp:t>([^<]*)</hp:t>", chunk))
                    if text.strip():
                        lines.append(unescape(text))
            return lines
    with open(path, encoding="utf-8") as handle:
        content = handle.read()
    if path.lower().endswith(".json"):
        return list(spec_lines(json.loads(content)))
    return content.splitlines()


def unescape(text):
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&amp;", "&")


def spec_lines(spec):
    """문서 양식 JSON에 든 글을 모두 꺼낸다."""
    for key in ("title", "date", "author"):
        if isinstance(spec.get(key), str):
            yield spec[key]
    for value in (spec.get("meta") or {}).values():
        yield str(value)
    for item in list(spec.get("lead") or []) + list(spec.get("body") or []) + list(spec.get("attachments") or []):
        if isinstance(item, str):
            yield item
        elif isinstance(item, dict) and isinstance(item.get("table"), list):
            for row in item["table"]:
                for cell in row:
                    yield str(cell)


def check(lines):
    """찾은 것을 (줄 번호, 그 부분, 안내) 목록으로 돌려준다."""
    found = []
    for number, line in enumerate(lines, start=1):
        for rule, message in DATE_RULES:
            for match in rule.finditer(line):
                y, m, d = (str(int(value)) for value in [group for group in match.groups() if group][:3])
                found.append((number, match.group(0), message.format(y=y, m=m, d=d)))
        for match in TIME_RULE.finditer(line):
            hour = int(match.group(2)) + (12 if match.group(1) == "오후" and int(match.group(2)) < 12 else 0)
            minute = int(match.group(3) or 0)
            found.append((number, match.group(0), f"시간은 24시각제로 '{hour:02d}:{minute:02d}'처럼 씁니다"))
        for match in MONEY_RULE.finditer(line):
            found.append((number, match.group(0), f"금액은 세 자리마다 쉼표를 찍습니다: '{int(match.group(1)):,}원'"))
        for match in LAW_RULE.finditer(line):
            name = match.group(1).strip()
            if name.split()[-1] in ("법", "법률") or name.endswith(("이 법", "같은 법", "동법")):
                continue
            part = match.group(0)[-30:]
            found.append((number, part, "법령 이름은 「」로 묶습니다 (예: 「보조금 관리에 관한 법률」 제26조)"))
        for rule, word, better in WORD_RULES:
            if rule.search(line):
                found.append((number, word, f"'{better}'(으)로 다듬어 쓰기를 권합니다"))
    return found


def report(found):
    if not found:
        return "표기 검사: 고칠 곳을 찾지 못했습니다."
    rows = [f"표기 검사: {len(found)}곳을 확인하세요."]
    rows += [f"  {number}째 줄 「{part}」 → {message}" for number, part, message in found]
    return "\n".join(rows)


def main(arguments):
    if len(arguments) != 1:
        print(__doc__)
        return 2
    print(report(check(lines_of(arguments[0]))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
