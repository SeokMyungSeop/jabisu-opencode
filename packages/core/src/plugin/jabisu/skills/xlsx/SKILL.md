---
name: xlsx
description: "엑셀(.xlsx) 파일을 만들거나 고칠 때 쓴다. '엑셀로 만들어줘', 'xlsx', '스프레드시트', '표를 엑셀 파일로', '집계표', '예산표 엑셀' 같은 요청에 쓴다. 엑셀 파일을 읽기만 할 때는 read 도구로 바로 읽는다."
---

# 엑셀(.xlsx) 파일 만들기

표 형태의 자료는 CSV로 쓴 뒤 `scripts/csv2xlsx.py`로 바꾸는 것이 가장 빠르다. 수식·차트·조건부 서식이나 기존 파일 고치기는 openpyxl 코드를 직접 쓴다. `<기본 폴더>`는 이 스킬의 기본 폴더(Base directory)다.

## 시작하기 전에

[python-setup.md](python-setup.md)대로 Python을 확인하고 패키지를 확인한다. 없으면 사용자에게 묻고 허락받은 뒤 설치한다.

```bash
python "<기본 폴더>/scripts/jabisu_python.py" check openpyxl
```

## 표 자료로 만들기

1. 시트마다 CSV 파일을 UTF-8로 쓴다. 첫 줄은 머리글이다. 쉼표가 들어간 칸은 큰따옴표로 감싼다(`"1,500,000"`).
2. 엑셀로 바꾼다.

   ```bash
   python "<기본 폴더>/scripts/csv2xlsx.py" 예산.xlsx 예산.csv 일정.csv --names "예산,일정"
   ```

   - 머리글은 굵게·배경색·틀 고정·자동 필터가 들어가고, 열 너비는 내용에 맞춘다.
   - `1,500,000` 같은 쉼표 숫자, `12.5%`, `2026-10-20`·`2026.10.20` 날짜는 값으로 바뀐다. `0`으로 시작하는 번호(우편번호 등)는 글자로 남는다.
   - `=SUM(B2:B9)`처럼 `=`로 시작하는 칸은 수식이 된다.
   - `--font`, `--size`로 글꼴과 크기를 바꿀 수 있다.
3. read 도구로 결과를 읽어 확인하고, 사용자에게 파일 경로를 알려 준다.

## 수식·차트·서식이 많은 파일, 기존 파일 고치기

openpyxl 코드를 직접 쓴다. 맨 위에 공용 패키지 폴더를 쓰는 줄을 넣는다.

```python
import sys; sys.path.insert(0, r"<기본 폴더>/scripts"); import jabisu_python
from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Font, PatternFill

workbook = Workbook()                     # 기존 파일은 load_workbook("예산.xlsx")
sheet = workbook.active
sheet.title = "예산"
sheet.append(["항목", "금액"])
for row in [["인건비", 1500000], ["운영비", 300000]]:
    sheet.append(row)
sheet.append(["합계", "=SUM(B2:B3)"])
for cell in sheet["B"]:
    cell.number_format = "#,##0"
for cell in sheet[1]:
    cell.font = Font(name="맑은 고딕", bold=True)
sheet.column_dimensions["A"].width = 14
sheet.conditional_formatting.add("B2:B3", CellIsRule(operator="greaterThan", formula=["1000000"], fill=PatternFill("solid", fgColor="FCE4D6")))
chart = BarChart()
chart.title = "항목별 금액"
chart.add_data(Reference(sheet, min_col=2, min_row=1, max_row=3), titles_from_data=True)
chart.set_categories(Reference(sheet, min_col=1, min_row=2, max_row=3))
sheet.add_chart(chart, "D2")
workbook.save("예산.xlsx")
```

- 계산은 엑셀이 하도록 수식으로 넣는다. 값만 미리 계산해 넣으면 자료를 고쳐도 합계가 바뀌지 않는다.
- openpyxl은 수식의 결과를 계산하지 않는다. 그래서 read 도구로 읽으면 수식 칸이 비어 보인다. 엑셀에서 열면 계산된다. 결과값을 꼭 확인해야 하면 같은 계산을 Python으로 따로 해 본다.
- `load_workbook`으로 열어 저장하면 차트·그림·매크로가 사라질 수 있다. 원본은 두고 새 이름으로 저장한 뒤 사용자에게 확인받는다.
- .xls(엑셀 97-2003) 파일은 openpyxl로 열 수 없다. read 도구로 읽은 내용으로 새 .xlsx를 만든다.

## 주의

- 결과 파일이 이미 있으면 덮어쓰기 전에 사용자에게 묻는다.
- 개인정보(주민등록번호 등)가 든 자료는 필요한 열만 넣는다.
