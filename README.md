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

이름에는 물을 **자(諮)**, 갖출 **비(備)**, 빼어날 **수(秀)** 를 써서, 물으면 늘 갖춰서 답하는 뛰어난 참모라는 뜻을 담았어요.

## 설치

1. [Releases](https://github.com/SeokMyungSeop/jabisu-opencode/releases/latest)에서 `Jabisu-Setup-<버전>-x64.exe`(예: `Jabisu-Setup-1.4.9-x64.exe`)를 내려받아요.
2. 내려받은 파일을 실행하면 바로 설치되고, 바탕화면과 시작 메뉴에 **자비수**가 생겨요.

- Windows 10/11 64비트용이에요. 관리자 권한 없이 내 사용자 폴더에 설치돼요.
- 설치 파일에 서명 인증서가 없어서 **"Windows의 PC 보호"** 창이 뜰 수 있어요. **추가 정보 → 실행**을 누르면 설치돼요.
- AI 모델은 앱 안의 **설정 → 공급자**에서 연결해요. 쓰는 모델의 API 키는 각자 넣어야 해요.

## OpenCode에 더한 기능

처음이라면 홈 화면 왼쪽의 **자비수 따라하기**부터 해 보세요. 업무 폴더 정하기 → 내 업무 프로필 만들기 → 업무 파일 찾아보기 → 행정 문서 만들어 보기 → 법령 물어보기를 단추 하나씩으로 해 볼 수 있고, **사용 설명서**(도움말 → 자비수 안내)는 인터넷 없이 앱 안에서 열려요.

| 기능 | 쓰는 법 |
|---|---|
| 브라우저 미리보기 | 만든 웹 앱의 개발 서버를 띄우고 앱 안의 브라우저로 바로 열어요 |
| 작업 알림 | 다른 창을 보는 동안 대화가 끝나거나 권한이 필요하면 알려 줘요. 제목은 대화 이름, 본문은 답변 첫 줄이에요 |
| 워크트리 다듬기 | 설정의 `worktree.branch_prefix`로 브랜치를 만들고, `.worktreeinclude`에 적은 파일을 함께 복사해요 |
| 세션 정보 패널 | 컨텍스트를 얼마나 썼는지 도넛 그래프로, 항목별(시스템 프롬프트·도구·스킬·지침·메시지)로는 토큰과 % 로 보여 줘요. 「스킬」을 누르면 검색되는 스킬 목록(내 스킬·기본 스킬·그 밖)이 열려요. 옆 패널로 열 수 있어요 |
| 세션 보관 | 보관하면 다 쓴 워크트리 폴더를 알아서 정리해요 |
| 새 창으로 열기 · 분할 화면 | 위쪽 탭을 오른쪽 클릭해서 대화를 새 창이나 옆 화면에 열어요 |
| 문서 읽기 | AI가 한글(.hwp, .hwpx), 워드(.docx, .doc), 엑셀(.xlsx, .xls), 파워포인트(.pptx, .ppt) 파일을 바로 읽어요. 한글 문서는 합쳐진 칸과 자동 번호까지 정확히 읽어요(kordoc). PDF를 못 읽는 모델에는 PDF의 글자를 뽑아 줘요 |
| 문서 미리보기 | 파일 보기에서 한글 파일과 옛 오피스 파일(.doc, .xls, .ppt)의 내용을 글과 표로 보여 줘요 |
| 앱 안에서 업데이트 | 새 버전이 나오면 오른쪽 위에 업데이트 단추가 떠요. 누르면 받아서 다시 시작해요 |
| 사용 금액 원화 표시 | 대화에 쓴 금액을 원(₩)으로 보여 줘요. 환율은 하루 한 번 유럽중앙은행 기준값을 받아 오고, **설정 → 환경 설정 → 사용 금액**에서 직접 넣거나 달러로 되돌려요 |
| 음성 받아쓰기 | 녹음·영상 파일(MP3, M4A, WAV, MP4 등)을 AI가 읽으면 `[00:12:30] 화자 1: …`처럼 시간과 화자를 붙인 글로 바꿔요. **설정 → 환경 설정 → 음성 받아쓰기**에서 켜요(OpenRouter 연결 필요, 기본 모델 `openai/gpt-audio-mini`, 1시간 녹음에 2분 안팎·약 90원). 긴 녹음은 조용한 곳에서 5분씩 나눠 받아쓰고, 빠진 구간·중국어가 섞인 줄·시간이 맞지 않는 줄은 `(확인 필요)`로 표시해요. 중간에 끊기면 같은 파일을 다시 읽을 때 빠진 구간만 받아써요. 소리는 OpenRouter를 거쳐 모델 회사로 보내져요 |
| 집현전 | 자료를 모아 두고 그 자료로 묻고 답해요. 홈 화면의 **집현전**에서 만들고 파일을 끌어다 넣으면, 자료에 맞는 지침(역할·맥락·작업·답변 양식)을 알아서 써 줘요. 대화 옆 **자료** 칸에서 자료를 보고, 답에 붙은 `[파일 · 3쪽]` 같은 출처를 누르면 그 파일이 열려요. 출처를 달 수 없는 문장이나 자료에 없는 해석은 쓰지 않고, 자료에 없는 질문은 다른 표현으로 더 찾아본 뒤 없다고 하고 웹을 찾아볼지 물어요. 스캔 이미지라 글자가 없는 쪽은 「일부만 검색됨」으로 알려 줘요. 자료는 `문서\자비수 집현전`에 있고, 탐색기에서 그 폴더의 `자료`에 파일을 넣어도 저절로 반영돼요 |
| 오류 안내와 신고 | 흔한 오류(API 키, 충전 금액, 요청 한도, 인터넷 연결, 모델 문제 등) 아래에 무엇을 하면 되는지 한국어로 알려 줘요. **오류 신고** 단추나 **도움말 → 오류 신고 · 피드백 보내기**를 누르면 버전과 오류 내용이 채워진 신고 양식(구글 설문지)이 브라우저에서 열려요. 그때 자비수 창을 캡처해 `사진\자비수 오류 캡처`에 저장하고 클립보드에도 복사해 두니, 원하면 양식에 올려요(구글 로그인이 필요하고, 올리면 구글 계정 이름과 이메일이 함께 기록돼요). 직접 보내기 전에는 아무것도 전송되지 않아요 |
| Craft 앱으로 편집 | PC에 Craft 앱(Learning Machines의 FilmCraft 영상, SoundCraft 소리, PhotoCraft 사진, PdfCraft PDF 등)이 깔려 있으면, "회의.mp4 앞 3초 자르고 자막 넣어 MP4로"처럼 말해서 편집을 맡겨요. 앱 화면 없이 뒤에서 처리하고 원본은 그대로 둬요. FilmCraft는 **Ctrl+;**(또는 `/mcp`)에서 「filmcraft」를 켜면 열려 있는 FilmCraft 화면을 보면서 조종해요(켜 둔 동안 질문마다 비용이 조금 늘어요). Craft 앱은 따로 설치해야 해요 |
| 기본 스킬 고쳐 쓰기 | **설정 → 환경 설정 → 기본 스킬**에서 기본 스킬을 **내 스킬로 복사**해 고쳐 써요. 업데이트해도 고친 내용이 남고, 업데이트로 그 기본 스킬이 바뀌면 계속 쓸지 물어봐요([자세히](#기본-스킬-고쳐-쓰기)) |
| 업무 비서 (1단계) | 자비수가 업무 파일을 찾아볼 폴더를 세 가지로 나눠 이 PC 안에서만 색인해요. **자비수 업무 폴더**(`문서\자비수 업무`, 자비수를 켜면 생기는 고정 폴더로 내 업무 프로필과 사무분장표 같은 기준 문서를 둬요), **받은 파일 폴더**(다운로드, 메신저 받은 파일 등), **업무 저장 폴더**(업무 문서를 정리해 두는 곳)예요. 뒤의 두 가지는 **설정 → 환경 설정 → 업무 비서**에서 골라요. "지난주 받은 실증사업 공문 찾아 줘"처럼 말하면 파일 이름과 **문서 내용**(한글·워드·엑셀·파워포인트·PDF)까지 빠르게 찾아요. AI 모델에는 폴더 전체가 아니라 찾은 결과만 가요. 사무분장표를 첨부하고 "내 업무 프로필 만들어 줘"라고 하면 `문서\자비수 업무\내 업무.md`가 생기고, 그 내용이 모든 대화에 함께 가서 자비수가 담당 업무를 알고 시작해요 |
| 행정 문서 양식 | "이 내용으로 결과보고서 만들어 줘", "회의록 만들어 줘", "보도자료 초안 써 줘"처럼 말하면 보고서·결과보고·계획(안)·메모보고·회의록·출장결과보고·보도자료를 기관 양식의 한글 파일로 만들어요. 제목 상자, □ ○ - 개조식과 내어쓰기, 개요 표, 보도자료 머리표가 갖춰지고, 날짜·시간·금액 표기와 다듬을 행정 용어를 자동으로 검사해요. 자료에 없는 숫자·발언·참석자는 지어내지 않고 `(확인 필요)`로 남겨 물어요 |
| 법령 찾기 | **설정 → 환경 설정 → 법령 찾기**에 법제처 인증키(open.law.go.kr에서 무료로 받아요. 신청할 때 이 PC의 공인 IP 주소를 등록해야 해요)를 넣으면, AI가 법령·자치법규·행정규칙(고시·훈령·예규)·판례·법령해석례를 국가법령정보센터 원문에서 찾아 근거로 답해요. 답과 보고서에 인용한 「법령명」 제N조 제M항 제K호가 실제로 있는지 원문과 대조해 없는 조문·항·호를 알려 줘요. 찾는 낱말은 법제처로 보내져요 |
| 작업실 | OpenCode의 「프로젝트」를 「작업실」이라고 불러요. 대화가 일하고 만든 파일을 저장하는 폴더예요(처음 켜면 `문서\기본 작업실`). 개발자용 항목(작업 공간, Git 상태, 시작 스크립트, ID 복사)은 숨겼고, 집현전은 홈의 「집현전」 칸에만 나와요 |
| 안전 장치 | AI가 작업실 밖 파일을 고치거나 만들 때, 파일을 지우거나 옮기거나 쓰는 명령(Remove-Item, del, Move-Item, Set-Content, `> C:\…` 등)을 쓸 때는 먼저 물어봐요. 다른 프로그램으로 감싼 명령(`powershell -Command …`, `cmd /c del …`)도 물어보고, 거절하면 다른 방법으로 우회하지 않아요. 파일을 찾을 때는 업무 폴더와 작업실에서만 찾고 개인 폴더 전체를 뒤지지 않아요. 읽기와 작업실 안에서 고치기는 바로 해요. 원본 OpenCode는 기본으로 모두 허용이에요 |

## 기본으로 들어 있는 스킬과 MCP

검증한 스킬이 미리 깔려 있어요. 자주 쓰는 스킬은 **켜져** 있고, 나머지는 **꺼진 채** 깔려 있다가 대화 중 필요해 보이면 AI가 "이 일에는 ○○ 스킬이 맞아요"라며 **이번 대화만 켜기 / 항상 켜기 / 괜찮아요** 중에서 고르게 해요. 꺼진 스킬은 질문할 때마다 AI에게 가는 설명이 짧아 비용이 거의 들지 않아요.

- 직접 켜고 끄기: **설정 → 환경 설정 → 기본 스킬**, 또는 대화의 **세션 세부 정보 → 컨텍스트 → 스킬**(한국어로 검색돼요)
- 꺼진 스킬도 입력창에 `@`를 치면 바로 부를 수 있어요(`/`는 명령 목록이에요).

문서를 **만드는** 스킬, 행정 문서 양식, 업무 비서 스킬은 켜져 있어요. "보고서를 한글 파일로 만들어줘"처럼 말하면 알아서 써요.

| 스킬 | 처음 상태 | 하는 일 |
|---|---|---|
| `admin-docs` | 켜짐 | 보고서·결과보고·계획(안)·메모보고·회의록·출장결과보고·보도자료를 기관 양식의 한글 파일로 만들고, 공문서 표기(날짜·시간·금액·법령 이름·행정 용어)를 검사해요. 자비수가 직접 만든 스킬이에요 |
| `hwpx` | 켜짐 | 한글(.hwpx) 공문을 서식에 맞춰 만들고, 한글 문서를 고치거나 .hwp를 .hwpx로 바꿔요 ([jkf87/hwpx-skill](https://github.com/jkf87), MIT) |
| `docx` | 켜짐 | 워드(.docx) 문서를 만들거나 고쳐요 |
| `xlsx` | 켜짐 | 엑셀(.xlsx) 표를 서식·수식·차트와 함께 만들어요 |
| `pptx` | 켜짐 | 파워포인트(.pptx) 발표 자료를 만들어요 |
| `work-profile` | 켜짐 | 사무분장표(업무분장표)로 `내 업무.md`(소속, 주업무, 대행, 관련 업무, 지난 업무, 업무 메모)를 만들고, 업무가 바뀌면 날짜와 함께 고쳐요 |

다른 프로그램을 대신 움직이는 스킬과, [Matt Pocock의 스킬](https://github.com/mattpocock/skills)(MIT) 중에서 고른 개발용 스킬은 꺼진 채 깔려 있어요.

| 스킬 | 처음 상태 | 하는 일 |
|---|---|---|
| `craft-apps` | 꺼짐 | PC에 깔린 Craft 앱(FilmCraft 영상, SoundCraft 소리, PhotoCraft 사진, LightCraft RAW 사진, PdfCraft PDF 등)을 명령줄로 움직여 편집해요. "회의.mp4 앞 3초 자르고 자막 넣어 MP4로"처럼 말하면 원본은 두고 새 파일을 만들어요 |
| `handoff` | 꺼짐 | 일을 멈출 때 다음 사람이 이어받을 정리 문서를 남겨요 |
| `diagnosing-bugs` | 꺼짐 | 막히는 프로그램 오류를 재현 → 가설 → 확인 순서로 끝까지 추적해요 |
| `grill-me` · `grilling` | 꺼짐 | 만들기 전에 계획이나 결정의 빈틈을 집요하게 질문해요 |
| `tdd` · `codebase-design` | 꺼짐 | 테스트를 먼저 쓰고, 테스트하기 좋은 구조로 만들어요 |

### 기본 스킬 고쳐 쓰기

기본 스킬은 업데이트할 때마다 새로 풀리기 때문에, 풀린 파일을 직접 고치면 고친 내용이 사라져요. 고쳐 쓰려면 이렇게 해요.

1. **설정 → 환경 설정 → 기본 스킬**에서 고칠 스킬의 **내 스킬로 복사**를 눌러요.
2. 내 스킬 폴더(`%USERPROFILE%\.config\opencode\skills\<이름>`)에 복사된 파일을 고쳐요. 같은 이름이면 내 스킬이 기본 스킬 대신 쓰이고, 업데이트해도 그대로 남아요.
3. 나중에 업데이트로 그 기본 스킬이 바뀌면 자비수가 물어봐요.
   - **고친 스킬 계속 쓰기(추천)**: 고친 내용이 그대로 쓰여요. 새 기본판의 개선은 들어오지 않아요.
   - **새 기본 스킬로 바꾸기**: 새 기본판을 써요. 고친 스킬은 `%USERPROFILE%\.config\opencode\skills-backup`에 옮겨 두니 다시 꺼내 쓸 수 있어요.
   - **나중에**: 다음에 켤 때 다시 물어요. 설정의 **기본 스킬**에서 하나씩 고를 수도 있어요.

내 스킬 폴더는 공식 OpenCode도 함께 읽어서, 거기서도 그 스킬이 보여요.

### 필요한 프로그램

자비수 자체는 설치만 하면 돼요. 대화, 파일과 문서 읽기, 미리보기에는 다른 프로그램이 필요 없어요.

| 프로그램 | 언제 필요한가 | 없으면 |
|---|---|---|
| [Python](https://www.python.org/downloads/) 3.10 이상 | 위의 문서 **만들기** 스킬을 쓸 때 | AI가 먼저 "Python을 설치할까요?" 하고 묻고, 허락하면 Windows 기본 도구(winget)로 설치해요 |
| 문서용 Python 부품 (python-docx, openpyxl, python-pptx, python-hwpx 등) | 문서 만들기 스킬을 처음 쓸 때 | 필요한 것만 AI가 묻고 허락받아 설치해요. `%USERPROFILE%\.local\share\opencode\jabisu\python`에 따로 두어서 시스템 Python을 건드리지 않고, 업데이트해도 남아요 |
| 법제처 인증키 (무료, [open.law.go.kr](https://open.law.go.kr)) | 법령 찾기를 쓸 때 (회원가입 → OPEN API 신청, 이 PC의 공인 IP 주소 등록) | 법령을 원문으로 확인하지 못해서, AI가 법령 내용에 `(확인 필요)`를 붙여요 |
| [Git](https://git-scm.com/) | 코드 작업실(Git 저장소)의 변경 기록과 되돌리기를 쓸 때 | 문서 작업에는 영향이 없어요 |
| Craft 앱 (FilmCraft 등) | 영상·소리·사진·PDF 편집을 맡길 때 (`craft-apps` 스킬, filmcraft MCP) | 그 편집만 못 해요. 자비수가 대신 설치하지 않아요 |

파일 검색 도구(ripgrep)는 처음 쓸 때 자비수가 알아서 받아요.

MCP 서버도 두 개 들어 있지만 둘 다 **꺼진 상태**예요. 켜 두면 질문할 때마다 그 도구 설명이 AI에게 함께 가서 비용이 조금 늘고, Context7은 질문 내용이 그 서버로 전송되기 때문이에요.

| MCP | 하는 일 |
|---|---|
| **Context7** | 라이브러리 최신 문서를 찾아봐요 |
| **filmcraft** | 열려 있는 FilmCraft 화면을 보면서 클릭·드래그로 편집해요. FilmCraft가 깔려 있을 때만 목록에 나와요. 원격 조종은 이 PC 안에서만 되고, 자비수가 만든 비밀 값이 있어야 연결돼요 |

- 잠깐 쓰기: **Ctrl+;**(또는 입력창에 `/mcp`)를 눌러 켜요. 앱을 다시 켜면 다시 꺼져요.
- 늘 켜 두기(Context7): 설정 파일 `~/.config/opencode/opencode.jsonc`의 `mcp`에 아래를 넣어요.

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
| 내 스킬 (고쳐 쓰는 스킬) | `%USERPROFILE%\.config\opencode\skills` |
| 내 스킬 백업 | `%USERPROFILE%\.config\opencode\skills-backup` |
| 업무 비서 폴더 설정 (받은 파일·업무 저장 폴더) | `%USERPROFILE%\.config\opencode\jabisu-work.json` |
| 업무 폴더 색인 | `%USERPROFILE%\.local\share\opencode\jabisu\work` |
| 법령 찾기 인증키 | `%USERPROFILE%\.config\opencode\jabisu-law.json` |
| 자비수 업무 폴더 (자비수를 켜면 생겨요) | `%USERPROFILE%\Documents\자비수 업무` |
| 내 업무 프로필 | `%USERPROFILE%\Documents\자비수 업무\내 업무.md` |

지울 때는 **설정 → 앱 → 설치된 앱 → 자비수 → 제거**를 눌러요. 대화 기록 파일은 지워지지 않고 남아요.

## 직접 빌드하기

Windows x64, [Bun](https://bun.sh) 1.4, Git Bash가 필요해요.

```bash
git clone -b jabisu https://github.com/SeokMyungSeop/jabisu-opencode.git
cd jabisu-opencode
bun install

export OPENCODE_CHANNEL=jabisu OPENCODE_VERSION=1.4.9
export OPENCODE_CLI_DIST="$(cygpath -w "$PWD/packages/cli/dist")"

# 1. 엔진(CLI): 앱이 구형 CPU 호환판을 넣어요
(cd packages/cli && bun run script/build.ts --target=opencode-windows-x64-baseline --skip-install)

# 2. 앱과 설치 파일
cd packages/desktop
bun ./scripts/prepare.ts            # 엔진·아이콘을 넣고 package.json 버전을 바꿔요
./node_modules/.bin/electron-vite build
bun run package:win                 # → packages/desktop/dist/Jabisu-Setup-1.4.9-x64.exe
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
- 문서 읽기에는 [SheetJS](https://sheetjs.com)(Apache-2.0), [unpdf](https://github.com/unjs/unpdf)(MIT)와 그 안의 PDF.js(Apache-2.0), 한글 문서용 [kordoc](https://github.com/chrisryugj/kordoc)(MIT, © chrisryugj)을 써요(`LICENSE.document-libraries.txt`).
- 법령 찾기는 법제처의 [국가법령정보 공동활용](https://open.law.go.kr) Open API로 국가법령정보센터(law.go.kr)의 원문을 읽어요. 법령 정보의 이용 조건은 법제처를 따르고, AI의 답은 법적 판단이 아니라 검토 자료예요.
- Craft 앱(FilmCraft, PdfCraft 등)은 Learning Machines LLC의 별도 제품이에요. 자비수에 들어 있지 않고, 사용자가 설치한 앱의 명령줄 도구를 불러 쓸 뿐이에요.
- 자비수 이름, 아이콘, 글자 디자인: 명상(明想)
