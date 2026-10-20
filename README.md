<p align="center">
  <img src="packages/desktop/icons/jabisu/icon.png" alt="자비수 아이콘" width="128" />
</p>

<h1 align="center">자비수(諮備秀)</h1>

<p align="center"><b>수석 AI 참모</b> · 만든이 명상(明想) · <a href="https://github.com/anomalyco/opencode">OpenCode</a> 기반</p>

<p align="center">
  <a href="https://github.com/SeokMyungSeop/jabisu-opencode/releases/latest"><b>⬇ 최신 버전 내려받기</b></a>
</p>

자비수는 오픈소스 AI 코딩 도우미 [OpenCode](https://github.com/anomalyco/opencode)의 데스크톱 앱을 바탕으로,
몇 가지 기능을 더하고 이름과 모습을 바꾼 Windows용 앱이에요.

이름에는 물을 **자(諮)**, 갖출 **비(備)**, 빼어날 **수(秀)**를 써서, 물으면 늘 갖춰서 답하는 뛰어난 참모라는 뜻을 담았어요.

## 설치

1. [Releases](https://github.com/SeokMyungSeop/jabisu-opencode/releases/latest)에서 `Jabisu-Setup-x64.exe`를 내려받아요.
2. 내려받은 파일을 실행하면 바로 설치되고, 바탕화면과 시작 메뉴에 **자비수**가 생겨요.

- Windows 10/11 64비트용이에요. 관리자 권한 없이 내 사용자 폴더에 설치돼요.
- 설치 파일에 서명 인증서가 없어서 **"Windows의 PC 보호"** 창이 뜰 수 있어요. **추가 정보 → 실행**을 누르면 설치돼요.
- AI 모델은 앱 안의 **설정 → 공급자**에서 연결해요. 쓰는 모델의 API 키는 각자 넣어야 해요.

## OpenCode에 더한 기능

| 기능 | 쓰는 법 |
|---|---|
| 브라우저 미리보기 | 만든 웹 앱의 개발 서버를 띄우고 앱 안의 브라우저로 바로 열어요 |
| 작업 알림 | 다른 창을 보는 동안 대화가 끝나거나 권한이 필요하면 알려 줘요. 제목은 대화 이름, 본문은 답변 첫 줄이에요 |
| 워크트리 다듬기 | 설정의 `worktree.branch_prefix`로 브랜치를 만들고, `.worktreeinclude`에 적은 파일을 함께 복사해요 |
| 세션 정보 패널 | 컨텍스트를 어디에 얼마나 쓰는지 항목별로 보여 주고, 옆 패널로 열 수 있어요 |
| 세션 보관 | 보관하면 다 쓴 워크트리 폴더를 알아서 정리해요 |
| 새 창으로 열기 · 분할 화면 | 위쪽 탭을 오른쪽 클릭해서 대화를 새 창이나 옆 화면에 열어요 |
| 문서 읽기 | AI가 한글(.hwp, .hwpx), 워드(.docx, .doc), 엑셀(.xlsx, .xls), 파워포인트(.pptx, .ppt) 파일을 바로 읽어요. PDF를 못 읽는 모델에는 PDF의 글자를 뽑아 줘요 |
| 문서 미리보기 | 파일 보기에서 한글 파일과 옛 오피스 파일(.doc, .xls, .ppt)의 내용을 글과 표로 보여 줘요 |
| 앱 안에서 업데이트 | 새 버전이 나오면 오른쪽 위에 업데이트 단추가 떠요. 누르면 받아서 다시 시작해요 |

## 기본으로 들어 있는 스킬과 MCP

설치하면 바로 쓸 수 있는 스킬이에요. [Matt Pocock의 스킬](https://github.com/mattpocock/skills)(MIT) 중에서 골랐어요.

| 스킬 | 하는 일 |
|---|---|
| `diagnosing-bugs` | 막히는 버그를 재현 → 가설 → 확인 순서로 끝까지 추적해요 |
| `handoff` | 작업을 멈출 때 다음 세션이 이어받을 정리 문서를 남겨요 |
| `grill-me` · `grilling` | 만들기 전에 계획의 빈틈을 집요하게 질문해요 (`@grill-me`로 불러요) |
| `tdd` · `codebase-design` | 테스트를 먼저 쓰고, 테스트하기 좋은 구조로 만들어요 |

문서를 **만드는** 스킬도 들어 있어요. "보고서를 한글 파일로 만들어줘"처럼 말하면 알아서 써요.

| 스킬 | 하는 일 |
|---|---|
| `hwpx` | 한글(.hwpx) 공문·보고서·회의록을 서식에 맞춰 만들고, .hwp를 .hwpx로 바꿔요 ([jkf87/hwpx-skill](https://github.com/jkf87), MIT) |
| `docx` | 워드(.docx) 문서를 만들거나 고쳐요 |
| `xlsx` | 엑셀(.xlsx) 표를 서식·수식·차트와 함께 만들어요 |
| `pptx` | 파워포인트(.pptx) 발표 자료를 만들어요 |

같은 이름의 스킬을 직접 설치하면 그쪽이 쓰여요. 입력창에 `@`를 치면 스킬 목록이 나와요(`/`는 명령 목록이에요).

### 필요한 프로그램

자비수 자체는 설치만 하면 돼요. 대화, 파일과 문서 읽기, 미리보기에는 다른 프로그램이 필요 없어요.

| 프로그램 | 언제 필요한가 | 없으면 |
|---|---|---|
| [Python](https://www.python.org/downloads/) 3.10 이상 | 위의 문서 **만들기** 스킬을 쓸 때 | AI가 먼저 "Python을 설치할까요?" 하고 묻고, 허락하면 Windows 기본 도구(winget)로 설치해요 |
| 문서용 Python 부품 (python-docx, openpyxl, python-pptx, python-hwpx 등) | 문서 만들기 스킬을 처음 쓸 때 | 필요한 것만 AI가 묻고 허락받아 설치해요. `%USERPROFILE%\.local\share\opencode\jabisu\python`에 따로 두어서 시스템 Python을 건드리지 않고, 업데이트해도 남아요 |
| [Git](https://git-scm.com/) | 코드 프로젝트의 변경 기록·작업 공간 기능을 쓸 때 | 문서 작업에는 영향이 없어요 |

파일 검색 도구(ripgrep)는 처음 쓸 때 자비수가 알아서 받아요.

**Context7 MCP**(라이브러리 최신 문서 찾아보기)도 들어 있지만 **꺼진 상태**예요. 쓰면 질문 내용이 Context7 서버로 전송되기 때문이에요.

- 잠깐 쓰기: **설정 → 확장 → MCP**에서 켜요. 앱을 다시 켜면 다시 꺼져요.
- 늘 켜 두기: 설정 파일 `~/.config/opencode/opencode.jsonc`의 `mcp`에 아래를 넣어요.

```jsonc
"context7": { "type": "remote", "url": "https://mcp.context7.com/mcp", "enabled": true }
```

## 공식 OpenCode와 함께 쓰기

자비수는 이름표(앱 ID)가 따로 있어서 공식 OpenCode 옆에 나란히 설치돼요.

- 대화 기록(`opencode-jabisu.db`)과 뒤에서 도는 서버는 따로 써서 섞이지 않아요.
- 설정 파일(`~/.config/opencode/opencode.jsonc`)과 로그인 정보(`auth.json`)는 OpenCode와 같이 써요.
- `opencode://` 링크는 OpenCode에 그대로 맡겨요. 업데이트는 OpenCode가 아니라 이 저장소의 Releases에서 받아요.
- 1.1.0 이하에서는 1.2.0을 한 번 직접 받아 설치해야 해요. 그다음부터는 앱 안의 업데이트 단추로 올라가요.

| 무엇 | 위치 |
|---|---|
| 프로그램 | `%LOCALAPPDATA%\Programs\jabisu` |
| 대화 기록 | `%USERPROFILE%\.local\share\opencode\opencode-jabisu.db` |
| 앱 설정 | `%APPDATA%\io.github.seokmyungseop.jabisu` |

지울 때는 **설정 → 앱 → 설치된 앱 → 자비수 → 제거**를 눌러요. 대화 기록 파일은 지워지지 않고 남아요.

## 직접 빌드하기

Windows x64, [Bun](https://bun.sh) 1.4, Git Bash가 필요해요.

```bash
git clone -b jabisu https://github.com/SeokMyungSeop/jabisu-opencode.git
cd jabisu-opencode
bun install

export OPENCODE_CHANNEL=jabisu OPENCODE_VERSION=1.2.0
export OPENCODE_CLI_DIST="$(cygpath -w "$PWD/packages/cli/dist")"

# 1. 엔진(CLI): 앱이 구형 CPU 호환판을 넣어요
(cd packages/cli && bun run script/build.ts --target=opencode-windows-x64-baseline --skip-install)

# 2. 앱과 설치 파일
cd packages/desktop
bun ./scripts/prepare.ts            # 엔진·아이콘을 넣고 package.json 버전을 바꿔요
./node_modules/.bin/electron-vite build
bun run package:win                 # → packages/desktop/dist/Jabisu-Setup-x64.exe
git checkout -- package.json        # prepare.ts가 바꾼 버전을 되돌려요
```

`jabisu` 채널은 자기 앱 ID, 설치 폴더, 서버 등록 파일을 쓰도록 되어 있어요. 이 설정은
`packages/desktop/src/main/constants.ts`와 `packages/desktop/electron-builder.config.ts`에 있어요.

- 릴리스에는 설치 파일과 함께 `packages/desktop/dist`의 `latest.yml`과 `.blockmap`을 올려야 앱 안 업데이트가 새 버전을 찾아요.
- 기본 스킬(`packages/core/src/plugin/jabisu/skills`)의 파일을 더하거나 빼면 `cd packages/core && bun run script/jabisu-bundle.ts`로 묶음 목록을 다시 만들어요.

## 라이선스와 원작

- 자비수는 [MIT 라이선스](LICENSE)를 따르는 [OpenCode](https://github.com/anomalyco/opencode)를 바탕으로 만들었어요. 설치 폴더에 원작 라이선스(`LICENSE.opencode.txt`)가 함께 들어 있어요.
- OpenCode는 Anomaly Innovations, Inc.의 등록 상표예요. 자비수는 공식 OpenCode가 아니며, OpenCode 팀과 관계없이 개인이 만든 배포판이에요.
- 기본 스킬 6개는 [mattpocock/skills](https://github.com/mattpocock/skills)(MIT, © Matt Pocock)에서 가져왔어요. 설치 폴더에 그 라이선스(`LICENSE.mattpocock-skills.txt`)가 함께 들어 있어요.
- `hwpx` 스킬은 jkf87의 hwpx-skill(MIT)을 Windows와 자비수에 맞게 고친 것이에요(`LICENSE.hwpx-skill.txt`).
- 문서 읽기에는 [SheetJS](https://sheetjs.com)(Apache-2.0), [unpdf](https://github.com/unjs/unpdf)(MIT)와 그 안의 PDF.js(Apache-2.0)를 써요(`LICENSE.document-libraries.txt`).
- 자비수 이름, 아이콘, 글자 디자인: 명상(明想)
