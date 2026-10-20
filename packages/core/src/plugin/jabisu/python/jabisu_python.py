"""자비수 문서 스킬의 Python 도우미.

문서 스킬(hwpx, docx, xlsx, pptx)이 함께 쓰는 패키지 폴더를 찾는다. 스크립트는 `import jabisu_python`으로
그 폴더를 먼저 찾고, 명령으로 실행하면 패키지를 확인하거나 설치한다.

    python jabisu_python.py check python-docx     # 없는 패키지를 알려 준다
    python jabisu_python.py install python-docx   # 사용자가 허락한 뒤에만 실행한다
"""

import importlib.util
import os
import subprocess
import sys

# 자비수가 스킬을 풀 때 데이터 폴더 안의 실제 경로로 바꿔 넣는다. 컴파일된 패키지(lxml, Pillow)는
# Python 버전을 타므로 버전마다 따로 둔다.
ROOT = r"__JABISU_PYTHON__"
PACKAGES = os.path.join(ROOT, f"py{sys.version_info[0]}{sys.version_info[1]}")
MINIMUM = (3, 10)

# 설치 이름과 import 이름이 다른 패키지.
MODULES = {
    "python-docx": "docx",
    "python-pptx": "pptx",
    "python-hwpx": "hwpx",
    "pyhwp": "hwp5",
    "pillow": "PIL",
}

if PACKAGES not in sys.path:
    sys.path.insert(0, PACKAGES)

# 자비수는 명령 출력을 UTF-8로 읽는다. Windows에서 파이프로 나가는 출력은 시스템 코드 페이지(cp949)가
# 기본이라 한글이 깨지므로 UTF-8로 바꾼다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def missing(packages):
    return [name for name in packages if importlib.util.find_spec(module(name)) is None]


def module(package):
    return MODULES.get(package.lower(), package.replace("-", "_"))


def main(arguments):
    if len(arguments) < 2 or arguments[0] not in ("check", "install"):
        print(__doc__)
        return 2
    if sys.version_info[:2] < MINIMUM:
        print(f"Python {sys.version.split()[0]}은 너무 오래되었습니다. Python 3.10 이상이 필요합니다.")
        return 1
    packages = arguments[1:]
    absent = missing(packages)
    if arguments[0] == "check":
        print(f"Python: {sys.version.split()[0]} ({sys.executable})")
        print(f"패키지 폴더: {PACKAGES}")
        if not absent:
            print("모두 있습니다: " + ", ".join(packages))
            return 0
        print("없습니다: " + ", ".join(absent))
        print("사용자에게 허락을 받은 뒤 설치합니다: python jabisu_python.py install " + " ".join(absent))
        return 1
    if not absent:
        print("이미 모두 있습니다: " + ", ".join(packages))
        return 0
    os.makedirs(PACKAGES, exist_ok=True)
    # 시스템 Python과 사용자 site-packages는 건드리지 않고 공용 폴더에만 설치한다.
    command = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--target", PACKAGES, *absent]
    print("설치합니다: " + " ".join(command))
    result = subprocess.run(command)
    if result.returncode != 0:
        return result.returncode
    importlib.invalidate_caches()
    still = missing(absent)
    if still:
        print("설치했지만 찾을 수 없습니다: " + ", ".join(still))
        return 1
    print("설치했습니다: " + ", ".join(absent))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
