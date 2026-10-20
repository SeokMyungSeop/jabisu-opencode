# Python 준비 (자비수 문서 스킬 공통)

문서 파일을 만드는 스크립트는 Python 3.10 이상과 몇 가지 패키지가 필요하다. 문서를 읽기만 할 때는 필요 없다(read 도구가 바로 읽는다). 만들기 전에 아래 순서로 확인한다. `<기본 폴더>`는 이 스킬의 기본 폴더(Base directory)다.

## 1. Python 확인

`python --version`을 실행한다.

- `Python 3.10` 이상이 나오면 3단계로 간다.
- 명령을 찾을 수 없거나, 아무것도 나오지 않거나, "Python was not found"라고 하면 Python이 없는 것이다. Windows의 `python`은 설치하기 전에는 Microsoft Store로 안내하는 바로가기일 뿐이다.
- `py --version`이 되면 이후 `python` 대신 `py`를 쓴다.
- 3.10보다 오래된 버전이면 Python이 없는 것처럼 2단계를 따른다.

## 2. Python이 없을 때

설치하기 전에 사용자에게 먼저 설명하고 허락을 받는다. 예: "워드·엑셀·한글 파일을 만들려면 Python(무료, 약 30MB)이 필요합니다. 지금 설치할까요?"

- 허락하면 Windows에서 이렇게 설치한다. 이 계정에만 설치하므로 관리자 권한이 필요 없다. 명령에 Python 약관(PSF 라이선스)과 winget 저장소 약관에 동의하는 옵션이 들어 있으니, 허락을 받을 때 그 점도 알린다.

  ```powershell
  winget install --id Python.Python.3.14 --exact --scope user --accept-package-agreements --accept-source-agreements
  ```

- winget이 없거나 실패하면 https://www.python.org/downloads/ 에서 직접 설치하도록 안내한다. 설치 첫 화면에서 "Add python.exe to PATH"를 켜라고 알려 준다.
- 설치 직후에는 자비수가 새 PATH를 모를 수 있다. `python`이 여전히 안 되면 전체 경로로 실행하거나(`& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe"`), 자비수를 다시 시작해 달라고 한다.
- macOS는 `brew install python` 또는 python.org, Linux는 배포판의 패키지 관리자로 설치한다.
- 사용자가 설치를 원하지 않으면, 같은 내용을 마크다운 같은 다른 형식으로 줄 수 있다고 제안한다.

## 3. 패키지 확인과 설치

```bash
python "<기본 폴더>/scripts/jabisu_python.py" check <패키지...>
```

- "모두 있습니다"가 나오면 바로 작업한다.
- 없는 패키지가 있으면 이름과 대략의 크기를 알리고 허락을 받은 뒤 설치한다.

  ```bash
  python "<기본 폴더>/scripts/jabisu_python.py" install <패키지...>
  ```

- 패키지는 자비수 데이터 폴더의 공용 폴더에 설치된다. 다른 문서 스킬과 함께 쓰고 자비수를 업데이트해도 남는다. 시스템 Python은 건드리지 않는다.
- 대략의 크기: python-docx 0.3MB, openpyxl 0.3MB, python-pptx 0.5MB, python-hwpx 1MB, 함께 설치되는 lxml 4MB, Pillow 7MB.

## 4. 직접 쓰는 Python 코드

스크립트 대신 코드를 직접 쓸 때는 맨 위에 다음 줄을 넣는다. 공용 패키지 폴더를 찾고, 한글 출력이 깨지지 않게 한다.

```python
import sys; sys.path.insert(0, r"<기본 폴더>/scripts"); import jabisu_python
```
