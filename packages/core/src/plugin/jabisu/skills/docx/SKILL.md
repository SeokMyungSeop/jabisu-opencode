---
name: docx
description: "워드(.docx) 문서를 만들거나 고칠 때 쓴다. '워드로 만들어줘', 'docx', '워드 파일', 'Word 문서', '보고서를 워드로', '문서 파일로 저장' 같은 요청에 쓴다. 워드 문서를 읽기만 할 때는 read 도구로 바로 읽는다."
---

# 워드(.docx) 문서 만들기

워드 문서는 마크다운으로 내용을 쓴 뒤 `scripts/md2docx.py`로 바꾸는 것이 가장 빠르고 안정적이다. 맑은 고딕, A4, 표·목록·그림·제목 서식이 기본으로 들어간다. `<기본 폴더>`는 이 스킬의 기본 폴더(Base directory)다.

## 시작하기 전에

[python-setup.md](python-setup.md)대로 Python을 확인하고 패키지를 확인한다. 없으면 사용자에게 묻고 허락받은 뒤 설치한다.

```bash
python "<기본 폴더>/scripts/jabisu_python.py" check python-docx
```

## 새 문서 만들기

1. 내용을 마크다운 파일로 쓴다. 저장 위치는 사용자가 원하는 곳(보통 작업 폴더)으로 한다.
2. 워드로 바꾼다.

   ```bash
   python "<기본 폴더>/scripts/md2docx.py" 보고서.md 보고서.docx
   ```

   - `--font "나눔고딕"` 글꼴, `--size 10.5` 본문 크기(pt), `--margin 20` 쪽 여백(mm)을 바꿀 수 있다.
3. read 도구로 `보고서.docx`를 읽어 내용과 표가 제대로 들어갔는지 확인한다.
4. 사용자에게 파일 경로를 알려 준다.

마크다운에서 쓸 수 있는 것:

| 쓰는 법 | 결과 |
|---|---|
| `#` ~ `######` | 제목 1~6 |
| 빈 줄 | 문단 나누기. 줄 끝 공백 두 칸이나 `\`는 같은 문단 안 줄바꿈 |
| `**굵게**` `*기울임*` `` `코드` `` `[글](주소)` | 글자 서식과 링크 |
| `- 항목`, `1. 항목` | 글머리표·번호 목록. 두 칸 들여쓰면 한 단계 아래(최대 3단계) |
| `\| 머리 \| 머리 \|` + `\|---\|:---:\|---:\|` | 표. 둘째 줄의 `:`로 왼쪽·가운데·오른쪽 정렬. 칸 안 `<br>`은 줄바꿈 |
| `> 인용` | 인용 문단 |
| ```` ``` ```` | 코드 블록 |
| `![설명](그림.png)` | 그림(본문보다 넓으면 줄이고 설명을 아래에 단다). 경로는 마크다운 파일 기준 |
| `---` | 가로줄 |
| `<!-- pagebreak -->` | 쪽 나누기 |

## 더 세밀한 서식이나 기존 문서 고치기

머리글·바닥글, 쪽 번호, 가로 방향 쪽, 기존 문서의 글 바꾸기처럼 위 변환으로 안 되는 일은 python-docx 코드를 직접 쓴다. 맨 위에 공용 패키지 폴더를 쓰는 줄을 넣는다.

```python
import sys; sys.path.insert(0, r"<기본 폴더>/scripts"); import jabisu_python
from docx import Document
from docx.shared import Pt

document = Document("보고서.docx")              # 기존 문서 (새 문서는 Document())
for paragraph in document.paragraphs:
    for run in paragraph.runs:                    # 글자 서식을 지키려면 run 단위로 바꾼다
        run.text = run.text.replace("2025년", "2026년")
footer = document.sections[0].footer.paragraphs[0]
footer.text = "자비수"
document.save("보고서-수정.docx")
```

- 한글 글꼴은 `run.font.name`만으로는 영문에만 적용된다. 한글까지 바꾸려면 `run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "맑은 고딕")`도 설정한다(`from docx.oxml.ns import qn`).
- 원본을 덮어쓰지 말고 새 이름으로 저장한 뒤, 사용자가 확인하면 바꾼다.
- .doc(워드 97-2003) 파일은 python-docx로 열 수 없다. read 도구로 읽은 내용을 바탕으로 새 .docx를 만든다.

## 주의

- 공문서처럼 한글(HWP) 양식이 필요한 문서는 hwpx 스킬을 쓴다.
- 결과 파일이 이미 있으면 덮어쓰기 전에 사용자에게 묻는다.
