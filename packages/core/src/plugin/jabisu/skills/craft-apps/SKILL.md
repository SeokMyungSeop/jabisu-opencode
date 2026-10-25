---
name: craft-apps
description: "PC에 설치된 Craft 앱(FilmCraft 영상, SoundCraft 소리, PhotoCraft 사진, LightCraft RAW 사진, VectorCraft 벡터, EffectCraft 모션, DesignCraft 디자인, FigCraft 화면 디자인, CADCraft 도면, PdfCraft PDF)을 명령줄로 움직여 편집할 때 쓴다. '영상 자르기', '자막 넣기', '영상 내보내기', 'mp4로 만들어줘', '영상 편집', '소리 정리', '사진 일괄 변환', 'FilmCraft', 'Craft 앱' 같은 요청에 쓴다."
---

# Craft 앱으로 편집하기

Craft 앱은 사용자가 따로 설치한 편집 프로그램이다. 앱마다 `<이름>-cli.exe`가 있어 화면 없이 명령으로 편집할 수 있다. `<기본 폴더>`는 이 스킬의 기본 폴더(Base directory)다.

## 설치된 앱 찾기

```powershell
Get-ChildItem "$env:ProgramFiles\*Craft\*-cli.exe" | Select-Object -ExpandProperty FullName
```

없는 앱은 쓰지 않는다. 앱을 설치하거나 내려받지 않는다. 필요하면 사용자에게 설치해 달라고 말한다.

## 공통 규칙

- 앱마다 명령줄 사용법이 다르다. 처음 쓰는 앱은 `& "<cli 경로>" --help`부터 읽는다. 명령 이름을 짐작하지 말고, `commands <낱말>`과 `describe <id>`가 있는 앱은 그것으로 찾는다.
- 원본 파일을 덮어쓰지 않는다. 결과는 원본 옆에 `-편집`을 붙인 새 이름이나 `결과` 폴더에 만든다. 덮어써야 하면 먼저 사용자에게 묻는다.
- 경로에 공백이 있으므로 `& "$env:ProgramFiles\FilmCraft\filmcraft-cli.exe" …`처럼 `&`와 따옴표로 실행한다. 아래 예는 PowerShell 기준이다. 셸이 bash 등이면 `powershell -NoProfile -Command '…'`로 감싼다.
- Windows PowerShell은 인자 속 큰따옴표를 지운다. JSON 인자는 `'{\"burnCaptions\":true}'`처럼 큰따옴표 앞에 `\`를 붙이거나, 아래처럼 단계 파일(JSONL)에 써서 넘긴다. `key=value` 꼴(`text="안녕 하세요"`, `'items=[1]'`)은 그대로 된다.
- 결과 JSON이 클 수 있다. `--compact`를 붙이고, 필요한 값만 `ConvertFrom-Json`으로 골라 본다.
- "exported …" 같은 진행 메시지는 오류 출력으로 나와서 PowerShell이 빨간 오류처럼 보여 줄 수 있다. 성공 여부는 `$LASTEXITCODE`(0이면 성공)와 결과 파일로 판단한다.
- 몇 분 걸리는 내보내기는 시작하기 전에 알린다.
- 결과는 그림으로 확인한다. 영상은 `render`로 한 프레임을 PNG로 뽑아 read 도구로 본다.

## FilmCraft: 화면 없이 영상 편집

프로젝트 파일(`.fcproj`)에 작업을 쌓는다. 처음에는 `--save-as`로 만들고, 그다음 명령마다 `--project <파일> --save`를 붙여야 바뀐 내용이 남는다. 프로젝트 파일 옆에 `FilmCraft Previews` 폴더가 생기므로, 프로젝트 파일은 원본 폴더가 아니라 `결과` 폴더에 둔다.

```powershell
$fc = "$env:ProgramFiles\FilmCraft\filmcraft-cli.exe"
$p = "D:\영상\결과\회의-편집.fcproj"
& $fc --compact --save-as $p import "D:\영상\회의.mp4"                          # {"items":[1]}
& $fc --compact --project $p --save exec file.newSequenceFromClip 'items=[1]'    # {"clips":[6,7],"sequence":4}
& $fc --compact --project $p --save exec timeline.razor seconds=3 track=V1
& $fc --compact --project $p --save exec timeline.razor seconds=3 track=A1
& $fc --compact --project $p inspect sequence                                    # 트랙별 클립 id와 start/end
& $fc --compact --project $p --save exec edit.rippleDelete 'clips=[6,7]'         # 앞 3초를 지우고 뒤를 당긴다
& $fc --compact --project $p --save exec captions.newTrack format=Subtitle language=ko
& $fc --compact --project $p --save exec captions.add text="안녕하세요" seconds=0 durationSeconds=4
& $fc --compact --project $p export "D:\영상\결과\회의-편집.mp4" --settings '{\"burnCaptions\":true}'
& $fc --compact --project $p render --seconds 1 --out "D:\영상\결과\확인.png"
```

- 시간은 대부분 `seconds=`, `frame=`, `timecode=`로 준다. `inspect`의 시간 단위는 1초에 254016000000이다.
- `timeline.razor`에 `track`을 주면 그 트랙만 자른다. 영상(V1)과 소리(A1)를 따로 자른다.
- 자막은 `burnCaptions`를 켜야 영상에 새겨진다. 켜지 않으면 내보낸 영상에 자막이 보이지 않는다.
- 여러 단계는 단계 파일로 한 번에 돌린다. 한 줄에 `{"id": …, "params": …}` 하나씩 쓰고 `#`로 주석을 단다. 앞 단계가 만드는 id가 필요 없을 때 쓴다. `file.exportMedia`는 파일이 다 써질 때까지 기다린다.
  ```text
  {"id":"captions.add","params":{"text":"두 번째 자막","seconds":6,"durationSeconds":2}}
  {"id":"file.exportMedia","params":{"path":"D:\\영상\\결과\\회의-편집.mp4","settings":{"burnCaptions":true}}}
  ```
  `& $fc --compact --project $p --save run "D:\영상\결과\단계.jsonl"`
- 내보내기 형식은 `export --list-presets`, `--format`, `--scale`, `--quality`, `--range`로 고른다. 소리만 뽑을 때는 `.wav`나 `.aac`로 내보낸다.
- 할 수 있는 일은 명령이 700개가 넘는다. 색 보정, 전환, 효과, 멀티캠, 자막, 음성 합성, 그래픽 글자 등은 `& $fc commands <낱말>`로 찾고 `describe`로 매개변수를 확인한다.

## FilmCraft: 열린 앱을 보며 조종하기

사용자가 편집하는 모습을 보고 싶어 하거나, 화면에서 해야 쉬운 일이면 실행 중인 FilmCraft를 직접 조종한다.

1. filmcraft MCP 도구(`ui_screenshot`, `command_run` 등)가 없으면, 사용자에게 **Ctrl+;**(또는 채팅창에 `/mcp`)를 눌러 「filmcraft」를 켜 달라고 한다. 다른 방법으로 연결하려 하지 않는다.
2. FilmCraft를 원격 조종으로 연다.
   `powershell -NoProfile -ExecutionPolicy Bypass -File "<기본 폴더>/scripts/start-filmcraft.ps1"`
   FilmCraft가 이미 원격 조종 없이 열려 있으면, 사용자에게 저장하고 닫아 달라고 한 뒤 다시 실행한다.
3. `ui_screenshot`으로 화면을 보고, `command_run`·`ui_click`·`ui_drag`·`ui_key`로 편집한다. 사용자의 프로젝트는 시키지 않으면 저장하지 않는다.

원격 조종에는 자비수가 만든 비밀 값(토큰)이 쓰인다. 스크립트가 알아서 읽으니, 그 값을 찾거나 보여 주거나 묻지 않는다.

## 다른 Craft 앱

모두 `--help`부터 읽는다. 자주 쓰는 길은 다음과 같다.

- **SoundCraft**(소리): `info`, `convert IN OUT --normalize`, `run --in S.scraft --cmd ID=JSON … --bounce OUT`, `commands`, `describe`
- **PhotoCraft**(사진): `info`, `convert IN OUT --quality 85`, `run <파일> --cmd <id> --params <json> --out <파일>`, `batch --actions <json> --in <폴더> --out <폴더>`
- **LightCraft**(RAW 사진): `render IN -o OUT --set light.exposure=0.5`, `run --import <파일> <명령> key=value …`
- **PdfCraft**(PDF): `info`, `text`, `edit --rotate/--delete/--move`, `combine`, `extract --pages`, `split`, `batch --steps convert,ocr,optimize`. PDF를 읽기만 할 때는 read 도구가 낫다. OCR 언어는 `--language`로 정하고, 되는 언어는 `--help`로 확인한다.
- **VectorCraft, EffectCraft, DesignCraft, FigCraft, CADCraft**: `--help`에 나온 대로 쓴다.
