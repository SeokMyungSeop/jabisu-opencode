---
name: pptx
description: "파워포인트(.pptx) 발표 자료를 만들거나 고칠 때 쓴다. 'PPT 만들어줘', '발표 자료', '슬라이드', 'pptx', '파워포인트', '보고 자료를 PPT로' 같은 요청에 쓴다. 발표 자료를 읽기만 할 때는 read 도구로 바로 읽는다."
---

# 파워포인트(.pptx) 발표 자료 만들기

발표 자료는 마크다운 개요로 쓴 뒤 `scripts/md2pptx.py`로 바꾸는 것이 가장 빠르다. 16:9 화면, 맑은 고딕, 제목 강조선, 표·그림·발표자 메모가 기본으로 들어간다. `<기본 폴더>`는 이 스킬의 기본 폴더(Base directory)다.

## 시작하기 전에

[python-setup.md](python-setup.md)대로 Python을 확인하고 패키지를 확인한다. 없으면 사용자에게 묻고 허락받은 뒤 설치한다(python-pptx는 그림 처리용 Pillow 7MB를 함께 설치한다).

```bash
python "<기본 폴더>/scripts/jabisu_python.py" check python-pptx
```

## 새 발표 자료 만들기

1. 개요를 마크다운 파일로 쓴다.

   ```markdown
   # 발표 제목
   부제목이나 발표자, 날짜
   > 발표자 메모

   ## 슬라이드 제목
   - 핵심 내용
     - 세부 내용
   일반 문장
   ### 소제목
   | 구분 | 내용 |
   |---|---|
   | 가 | 나 |
   ![그림 설명](그림.png)
   ```

   - `#`는 표지, `##`는 새 슬라이드, `###`는 슬라이드 안 굵은 줄이다.
   - `- `·`1. ` 목록은 두 칸 들여쓰면 한 단계 아래(최대 5단계), 일반 문장은 글머리 기호 없이 들어간다.
   - 표와 그림은 글 아래 남은 자리에 맞춰 들어간다. 그림 경로는 마크다운 파일 기준이다.
   - `> `로 시작하는 줄은 그 슬라이드의 발표자 메모가 된다.
2. 파워포인트로 바꾼다.

   ```bash
   python "<기본 폴더>/scripts/md2pptx.py" 발표.md 발표.pptx
   ```

   - `--font "나눔고딕"`으로 글꼴, `--standard`로 4:3 화면을 쓸 수 있다.
3. read 도구로 `발표.pptx`를 읽어 슬라이드 순서와 내용을 확인한다.
4. 사용자에게 파일 경로를 알려 준다.

## 잘 만드는 요령

- 슬라이드 한 장에 글머리 6줄 안팎으로 쓴다. 넘치면 글씨가 작아진다(5줄 이하 24pt, 8줄 이하 20pt, 12줄 이하 16pt).
- 문장보다 짧은 구절로 쓰고, 자세한 설명은 발표자 메모로 옮긴다.
- 표는 6행 이하가 읽기 좋다. 더 크면 슬라이드를 나눈다.
- 글과 표·그림을 한 슬라이드에 함께 넣으면 글은 위쪽, 표·그림은 아래쪽에 들어간다.

## 더 세밀한 디자인이나 기존 자료 고치기

python-pptx 코드를 직접 쓴다. 맨 위에 공용 패키지 폴더를 쓰는 줄을 넣는다.

```python
import sys; sys.path.insert(0, r"<기본 폴더>/scripts"); import jabisu_python
from pptx import Presentation
from pptx.util import Pt

presentation = Presentation("발표.pptx")
for slide in presentation.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:          # 서식을 지키려면 run 단위로 바꾼다
                    run.text = run.text.replace("2025", "2026")
presentation.save("발표-수정.pptx")
```

- 한글 글꼴은 `run.font.name`만으로는 영문에만 적용된다. 한글에도 적용하려면 `a:ea` 요소의 typeface도 바꾼다(`scripts/md2pptx.py`의 `set_font` 참고).
- 회사·기관 서식 파일(.pptx)이 있으면 `Presentation("서식.pptx")`로 열어 그 레이아웃을 쓴다.
- 원본은 두고 새 이름으로 저장한 뒤 사용자에게 확인받는다. .ppt(97-2003) 파일은 python-pptx로 열 수 없으니 read 도구로 읽은 내용으로 새로 만든다.

## 주의

- 결과 파일이 이미 있으면 덮어쓰기 전에 사용자에게 묻는다.
