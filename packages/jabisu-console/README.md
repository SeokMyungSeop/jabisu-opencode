# 자비수 무료 LLM 콘솔

자비수 앱의 공급자 「자비수 무료 LLM 콘솔」을 받쳐 주는 중계 프로그램입니다. 명상 PC의 WSL(우분투)에서 PM2로 돌고,
홈페이지와 같은 Cloudflare 터널(`sejong-nexus`)로 `https://llm.sejong-nexus.ai.kr`에 공개됩니다. 앱 사용자는 키 없이,
이용 안내에 동의한 뒤 무료 모델을 먼저 쓰고, 무료가 막히면 정해 둔 유료 모델을 한도 안에서 씁니다.

## 하는 일

- **동의 확인**: 앱에서 이용 안내(대화가 학습에 쓰일 수 있음, 개인정보·비공개 자료 금지)에 동의한 설치만 받아요.
  설치 번호, 안내문 판, 동의 시각, 주소를 기록해요.
- **한도**: 처음 쓴 날부터 7일은 유료 몫 ₩300 → ₩200 → ₩100…·무료 요청 하루 100번, 8일째부터는 끝없이 하루
  ₩50·무료 요청 30번. 1시간 질문 10번, 주소 하나 하루 ₩1,000, 콘솔 전체 하루 ₩1,600 · 한 달 ₩50,000. 한도는 보내기
  전에 확인하고 답이 끝난 뒤에 세요.
- **모델 자동 점검**: 하루 한 번(그리고 무료 모델이 잇달아 실패하면) OpenRouter 공개 목록에서 무료 후보를 골라
  한국어 + 도구 쓰기 시험을 보고, 통과한 모델을 앞에 둬요. 맨 뒤는 유료 `deepseek/deepseek-v4.1-flash`.
- **금액 숨김**: 앱으로 가는 답에서 비용 값을 지워요. 금액은 관리 화면에서만 보여요.
- **내용 저장 안 함**: 대화 내용은 저장하지 않고 숫자(모델·토큰·금액·시각)만 남겨요.
- **사용자 주소**: Cloudflare가 알려 주는 실제 주소(`cf-connecting-ip`)로 주소별 한도를 세요.

## 처음 한 번 준비

1. **전용 OpenRouter 키**: OpenRouter에서 무료 콘솔 전용 워크스페이스와 키를 만들고, 월 한도를 걸어요(월 ₩50,000에
   맞추려면 $35).
2. **키 파일**: 윈도우 탐색기 주소창에 `\\wsl$\Ubuntu-22.04\home\myungsang\.jabisu-console`을 넣어 연 뒤,
   `openrouter-key.txt`를 만들고 키 한 줄만 넣어 저장해요.
3. **무료 모델 학습 허용**: openrouter.ai → Settings → Privacy의 「Allow free endpoints that train on request data」를
   켜 둬요. 끄면 학습하는 무료 모델(NVIDIA 등)이 막혀요. 앱의 이용 안내가 이 점을 알리고 동의를 받아요.
4. **터널 주소 추가**: 이 터널은 주소 규칙을 Cloudflare 웹사이트에서 받아요(PC의 `config.yml`은 쓰지 않아요).
   one.dash.cloudflare.com → Networks → Tunnels → `sejong-nexus` → 공개 호스트 이름(Public Hostname, 새 화면에서는
   Published application routes) 추가: 하위 도메인 `llm`, 도메인 `sejong-nexus.ai.kr`, 서비스 `HTTP` ·
   `localhost:4317`. 관리 화면 포트(4318)는 절대 추가하지 않아요.

## 켜기와 끄기 (WSL에서 PM2로)

PM2가 홈페이지처럼 자동으로 켜고, 꺼지면 다시 켜요. WSL 터미널에서:

```bash
PM2=$HOME/.npm-global/bin/pm2
$PM2 ls                       # 상태 보기 (jabisu-console)
$PM2 logs jabisu-console      # 기록 보기
$PM2 restart jabisu-console   # 다시 켜기 (코드를 고친 뒤)
$PM2 stop jabisu-console      # 끄기
```

처음 등록할 때는 이렇게 했어요(Node 24를 지정해야 해요):

```bash
cd /mnt/c/000.cluade_code/opencode-jabisu/packages/jabisu-console
$PM2 start src/main.ts --name jabisu-console --interpreter $HOME/.nvm/versions/node/v24.22.1/bin/node \
  --node-args="--disable-warning=ExperimentalWarning" --time
$PM2 save
```

- 관리 화면: <http://127.0.0.1:4318> (이 PC에서만 열려요). 오늘·이번 달 사용액, 무료 요청 수, 키 남은 한도, 모델 순서와
  점검 기록, 설치 번호별 사용량을 보고, 「창구 닫기/열기」와 「지금 점검」을 할 수 있어요.
- PC가 꺼져 있거나 창구를 닫으면, 앱은 「무료 창구가 쉬고 있어요. 내 OpenRouter 키를 연결하세요」라고 안내해요.
- 윈도우에서 바로 시험할 때는 `start-console.cmd`를 두 번 눌러도 돼요(이때 기록은 `%LOCALAPPDATA%\jabisu-console`).

## 설정 바꾸기

`~/.jabisu-console/settings.json`(윈도우에서 직접 켤 때는 `%LOCALAPPDATA%\jabisu-console\settings.json`)에 바꿀
값만 적고 콘솔을 다시 켜요. 예:

```json
{
  "paidModel": "deepseek/deepseek-v4.1-flash",
  "exclude": ["어떤/모델:free"],
  "prefer": [],
  "limits": {
    "trialDays": [300, 200, 100, 100, 100, 100, 100],
    "afterTrialKrw": 50,
    "freeRequestsPerDay": 100,
    "afterTrialFreeRequests": 30,
    "questionsPerHour": 10,
    "monthlyKrw": 50000
  }
}
```

- 앱 쪽 이용 안내 문구를 바꾸면 `consentVersion`도 함께 올려요. 그러면 모두에게 다시 동의를 받아요.
- 시험할 때는 `JABISU_CONSOLE_HOME`(기록 폴더)과 `JABISU_CONSOLE_KEY_FILE`(키 파일)로 다른 곳을 가리킬 수 있어요.

## 개발

```bash
node --test test/*.test.ts
```

외부 패키지 없이 Node 24의 내장 기능(`node:sqlite`, TypeScript 실행)만 써요.
