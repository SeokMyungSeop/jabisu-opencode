// 자비수 speaks to office workers rather than developers. Its Korean strings call a project 「작업실」 — the folder a
// conversation works in and saves to — and a session 「대화」 (a new one 「새 대화창」), and fill in strings that have no
// Korean translation yet. The renaming is a rule rather than a copy of every string, so strings added upstream are
// renamed too.

// Particles after 「프로젝트」 (ending in a vowel) change after 「작업실」 (ending in ㄹ); 로 and the rest stay.
const PARTICLES: Record<string, string> = { 를: "을", 가: "이", 는: "은", 와: "과" }

/** 「프로젝트」 → 「작업실」, with the particle after it fitted to the new last sound. */
export const workroom = (text: string) =>
  text.replace(/프로젝트(를|가|는|와)?/g, (_match, particle?: string) => `작업실${particle ? PARTICLES[particle] : ""}`)

// Particles after 「세션」 (ending in ㄴ) change after 「대화」 (ending in a vowel). 「새 대화창」 ends in ㅇ like 「세션」,
// so its particles stay.
const CONVERSATION_PARTICLES: Record<string, string> = { 으로: "로", 을: "를", 이: "가", 은: "는", 과: "와" }

/** 「새 세션」 → 「새 대화창」 and any other 「세션」 → 「대화」, with the particle after it fitted to the new last sound. */
export const conversation = (text: string) =>
  text
    .replace(/새 세션/g, "새 대화창")
    .replace(
      /세션(으로|을|이|은|과)?/g,
      (_match, particle?: string) => `대화${particle ? CONVERSATION_PARTICLES[particle] : ""}`,
    )

/** Every renaming rule, for strings that come from anywhere in the app, extensions included. */
export const jabisuWords = (text: string) => conversation(workroom(text))

// Strings upstream has not translated into Korean yet, worded as its Korean is, so the renaming rules apply to them
// too. A test fails once upstream translates one, so the list holds only what is still missing.
export const MISSING: Record<string, string> = {
  "command.provider.connect.description": "OpenCode Go, OpenCode Console 또는 다른 모델 공급자에 로그인합니다",
  "command.session.previous": "이전 세션",
  "command.session.next": "다음 세션",
  "command.session.previous.unseen": "읽지 않은 이전 세션",
  "command.session.next.unseen": "읽지 않은 다음 세션",
  "palette.group.recentSessions": "최근 세션",
  "dialog.model.chatgptPlan": "ChatGPT 요금제 사용 중",
  "dialog.model.chatgptManageUsage": "사용량 관리",
  "dialog.provider.accounts.count.one": "계정 {{count}}개",
  "dialog.provider.accounts.count.other": "계정 {{count}}개",
  "dialog.provider.accounts.add": "다른 계정 추가",
  "dialog.provider.accounts.connected": "연결된 계정",
  "dialog.provider.accounts.removeConfirm": "{{account}} 계정을 제거할까요?",
  "dialog.provider.accounts.remove": "제거",
  "dialog.provider.accounts.options": "{{account}} 옵션",
  "provider.connect.opencode.name": "OpenCode Console",
  "provider.connect.opencode.freeName": "OpenCode 무료",
  "provider.connect.opencode.errorTitle": "OpenCode 연결",
  "provider.connect.console.title": "OpenCode Console에 연결하는 중",
  "provider.connect.console.titleGo": "OpenCode Go에 연결하는 중",
  "provider.connect.console.intro": "OpenCode Console 계정으로 로그인해 사용할 수 있는 모델을 쓰세요.",
  "provider.connect.console.continue": "브라우저에서 계속",
  "provider.connect.console.retry": "다시 시도",
  "provider.connect.console.serviceKeyDescription": "OpenCode Console의 서비스 계정 API 키로 연결합니다.",
  "provider.connect.console.instructions": "브라우저에서 계속하세요. 브라우저에 보이는 코드가 아래 코드와 같은지 확인하세요.",
  "provider.connect.console.deviceCode": "기기 코드",
  "provider.connect.console.deviceCode.label": "기기 코드: {{code}}",
  "provider.connect.console.waiting": "확인을 기다리는 중…",
  "provider.connect.console.browserHint": "브라우저가 열리지 않았나요?",
  "provider.connect.console.copyLink": "로그인 링크 복사",
  "provider.connect.console.linkCopied": "로그인 링크를 복사했습니다",
  "provider.connect.console.copyFailed": "로그인 링크를 복사하지 못했습니다. Console을 다시 열어 계속하세요.",
  "provider.connect.console.openAgain": "Console 다시 열기",
  "provider.connect.console.browserFailed":
    "브라우저를 열지 못했습니다. 다시 시도하거나 로그인 링크를 복사해 계속하세요.",
  "provider.connect.console.expired": "로그인 요청이 만료되었습니다. 다시 시작해 새 기기 코드를 받으세요.",
  "provider.connect.console.denied": "Console에서 접근이 거부되었습니다. 연결할 준비가 되면 다시 시도하세요.",
  "provider.connect.console.statusFailed": "승인 상태를 확인하지 못했습니다. 서버 연결을 확인하고 다시 시도하세요.",
  "provider.connect.console.startFailed": "로그인을 시작하지 못했습니다. 서버 연결을 확인하고 다시 시도하세요.",
  "provider.connect.chatgptWelcome.title": "ChatGPT 연결됨",
  "provider.connect.chatgptWelcome.description": "조건에 맞는 요청은 ChatGPT 요금제로 쓸 수 있습니다.",
  "provider.connect.chatgptWelcome.usage": "ChatGPT 설정에서 사용량 관리",
  "provider.connect.chatgptWelcome.confirm": "확인",
  "provider.connect.chatgptUsageLimit.title": "ChatGPT 사용 한도에 도달했습니다",
  "provider.connect.chatgptUsageLimit.description": "ChatGPT 설정에서 사용량과 한도를 확인하세요.",
  "provider.connect.chatgptUsageLimit.manage": "사용량 관리",
  "provider.connect.chatgptUsageLimit.close": "닫기",
  "provider.connect.console.refreshFailed": "계정은 연결되었지만 모델을 불러오지 못했습니다. 다시 시도해 새로 고치세요.",
  "provider.connect.console.connected": "OpenCode 연결됨",
  "provider.connect.console.noModels":
    "계정은 연결되었지만 이 Console 워크스페이스에 쓸 수 있는 모델이 없습니다. Console에서 설정을 확인한 뒤 새로 고치세요.",
  "provider.connect.console.modelsLoading": "모델을 아직 불러오는 중입니다. 새로 고쳐 다시 확인하세요.",
  "provider.connect.console.refresh": "모델 새로 고침",
  "provider.connect.console.openingBrowser": "브라우저를 여는 중…",
  "provider.connect.console.serviceAccount": "서비스 계정인가요?",
  "provider.connect.console.useApiKey": "API 키 사용",
  "provider.connect.remote.title": "「{{server}}」에서 연결하는 중",
  "provider.connect.remote.description": "연결 정보는 이 서버에 저장되고, 모델은 이 서버를 거쳐 쓸 수 있습니다.",
  "provider.connect.oauth.auto.confirmationCode.description": "승인하기 전에 브라우저에 같은 코드가 보이는지 확인하세요.",
  "provider.connect.oauth.auto.description":
    "{{provider}}에 로그인하도록 브라우저가 열립니다. 로그인을 마치면 여기로 돌아오세요.",
  "provider.connect.oauth.code.description":
    "{{provider}}에 로그인하도록 브라우저가 열립니다. 받은 인증 코드를 아래에 붙여넣으세요.",
  "provider.connect.oauth.openBrowser": "브라우저 열기",
  "provider.connect.oauth.expired": "인증이 만료되었습니다",
  "common.retry": "다시 시도",
  "prompt.toast.unqueueable.title": "이 요청은 대기열에 넣을 수 없습니다",
  "server.connect.description.pairing": "서버의 페어링 링크를 붙여넣거나 QR 코드를 스캔하세요.",
  "server.connect.link": "페어링 링크",
  "server.connect.link.placeholder": "http://192.168.1.2:4096/auth/connect/…",
  "server.connect.link.invalid":
    "opencode pair 또는 서버 컴퓨터의 설정 → 페어링에서 받은 페어링 링크 전체를 붙여넣으세요.",
  "server.connect.password.prompt": "페어링 링크가 없나요?",
  "server.connect.password.use": "비밀번호 사용",
  "server.connect.password.hint": "비밀번호를 보려면 서버 컴퓨터에서 opencode service get password를 실행하세요.",
  "server.connect.link.prompt": "페어링 링크가 있나요?",
  "server.connect.link.use": "페어링 링크 사용",
  "server.connect.pair.link": "서버 컴퓨터에서 이 명령을 실행하면 페어링 링크와 QR 코드가 나옵니다.",
  "server.connect.scan.failed": "이 브라우저는 QR 코드를 읽지 못했습니다. 연결 정보를 직접 입력하세요.",
  "server.connect.link.expired": "만료되었거나 이미 쓴 페어링 링크입니다. opencode pair를 실행해 새 링크를 받으세요.",
  "server.connect.link.unreachable": "{{url}}에 연결할 수 없습니다. 이 기기에서 서버에 닿는지 확인한 뒤 다시 시도하세요.",
  "server.connect.link.legacy":
    "이전 버전 OpenCode의 페어링 코드입니다. 서버의 OpenCode를 업데이트한 뒤 opencode pair를 다시 실행하세요.",
  "server.connect.camera.native": "이 페이지는 HTTP에서 카메라를 쓸 수 없습니다. 위에 페어링 링크를 붙여넣으세요.",
  "dialog.server.signedOut":
    "이 서버의 로그인이 더 이상 유효하지 않습니다. 새 페어링 링크를 붙여넣거나 서버 비밀번호를 입력하세요.",
  "session.tab.more": "더 보기...",
  "session.queue.undo": "되돌리기",
  "session.queue.undoShell": "대기 중인 요청을 되돌리기 전에 셸 모드에서 나가세요",
  "session.queue.reverted": "대기 중인 요청의 순서를 바꾸거나 고치기 전에 되돌린 내용을 다시 적용하세요",
  "session.running.working.one": "{{count}}개 작업 중",
  "session.running.working.other": "{{count}}개 작업 중",
  "session.running.running.one": "{{count}}개 실행 중",
  "session.running.running.other": "{{count}}개 실행 중",
  "session.running.additionalWorking.one": "+{{count}}개 작업 중",
  "session.running.additionalWorking.other": "+{{count}}개 작업 중",
  "session.running.additionalRunning.one": "+{{count}}개 실행 중",
  "session.running.additionalRunning.other": "+{{count}}개 실행 중",
  "session.running.stop.subagent": "하위 에이전트 중단",
  "session.running.stop.shell": "셸 명령 종료",
  "session.question.title": "질문",
  "titlebar.tab.openInNewWindow": "새 창에서 열기",
  "titlebar.tab.openInSplit": "분할 화면으로 열기",
  "split.close": "분할 화면 닫기",
  "settings.guiExtensions.title": "확장 기능",
  "settings.guiExtensions.description": "이 창에 내장된 GUI 확장 기능입니다. 개발용 빌드에서만 보입니다.",
  "settings.guiExtensions.reload": "다시 불러오기",
  "settings.guiExtensions.status.loading": "불러오는 중",
  "settings.guiExtensions.status.active": "작동 중",
  "settings.guiExtensions.status.failed": "실패",
  "settings.guiExtensions.status.disabled": "꺼짐",
  "settings.guiExtensions.status.blocked": "차단됨",
  "settings.about.notices.title": "제3자 고지",
  "settings.about.notices.description": "이 앱에는 다음 오픈 소스 소프트웨어가 들어 있습니다.",
  "settings.about.notices.license": "라이선스 전문",
  "settings.about.notices.fonts.title": "Office 미리 보기의 글꼴",
  "settings.about.notices.fonts.description":
    "각 글꼴은 아래 저작권 표시와 함께 SIL Open Font License 1.1로 배포됩니다.",
  "settings.about.notices.eigenpal": "BetterOffice의 일부는 이 소프트웨어에서 파생되었습니다.",
  "settings.about.notices.loadFailed": "제3자 고지를 불러오지 못했습니다",
  "settings.about.notices.crates.title": "Office 엔진의 Rust 크레이트",
  "settings.about.notices.crates.description":
    "BetterOffice는 Word, Excel, PowerPoint 엔진에 이 크레이트를 넣어 컴파일합니다. 라이선스를 고를 수 있는 크레이트에는 강조한 라이선스가 적용됩니다.",
  "settings.about.notices.crates.licenses": "라이선스 전문",
  "settings.about.notices.crates.count.one": "크레이트 {{count}}개",
  "settings.about.notices.crates.count.other": "크레이트 {{count}}개",
  "settings.about.notices.crates.appliesTo": "{{names}}에 적용",
  "settings.timeline.row.turnDiffs.title": "바뀐 파일",
  "settings.timeline.row.turnDiffs.description": "답변이 끝날 때마다 그 답변이 바꾼 파일을 보여 줍니다",
  "settings.providers.account.manage": "{{provider}} 계정 관리",
  "settings.providers.account.group": "계정",
  "settings.providers.account.add": "계정 추가",
  "settings.providers.account.name": "계정 이름",
  "settings.providers.account.switched.title": "{{provider}} 계정을 바꿨습니다",
  "settings.providers.account.switched.description": "이제 {{account}} 계정을 씁니다.",
  "settings.providers.account.removed.title": "{{account}} 계정을 제거했습니다",
  "settings.providers.account.removed.description": "{{provider}}에서 더 이상 이 계정을 쓰지 않습니다.",
  "settings.providers.console.available.one": "쓸 수 있는 공급자 {{count}}개",
  "settings.providers.console.available.other": "쓸 수 있는 공급자 {{count}}개",
  "settings.providers.tag.account": "계정",
  "settings.models.enableAll": "모든 모델 켜기",
  "settings.models.disableAll": "모든 모델 끄기",
  "settings.permissions.autoAccept.default.description":
    "권한 요청을 묻지 않고 승인합니다. 파일 지우기·옮기기와 작업실 밖 파일 고치기는 켜져 있어도 묻습니다. 작업실마다 따로 정할 수 있습니다.",
  "ui.sessionTurn.freeLimit.title": "오늘의 무료 메시지를 모두 썼습니다.",
  "ui.sessionTurn.freeLimit.lineReset": "오늘의 무료 메시지를 모두 썼습니다. {{time}}에 다시 채워집니다.",
  "dialog.usageExceeded.freeTier.reset": "무료 메시지는 {{time}}에 다시 채워집니다.",
  "ui.messagePart.compaction.queued": "세션 압축 대기 중",
  "ui.message.copyFullMessage": "메시지 전체 복사",
  "ui.message.moveToQueue": "대기열로 옮기기",
  "ui.message.pending": "대기 중",
  "ui.message.voice": "음성",
  "ui.message.deletePending": "삭제",
  "ui.message.modelVariant": "{{model}} ({{variant}})",
  "ui.sessionTimeline.notice.variantSwitched": "생각 수준을 {{variant}}(으)로 바꿨습니다",
  "ui.sessionTimeline.notice.variantDefault": "생각 수준을 기본값으로 바꿨습니다",
  "ui.question.custom.answerPlaceholder": "직접 답을 입력하세요…",
}

// Strings worded for 자비수, which the renaming rules do not reach: some have no upstream Korean, others are worded
// for developers or for OpenCode.
const OVERRIDES: Record<string, string> = {
  "project.settings.name.description": "자비수 곳곳에서 이 작업실에 표시되는 이름",
  "settings.permissions.tool.external_directory.description": "작업실 폴더 밖의 파일에 접근",
  "settings.projects.description": "작업실별 설정 관리",
  "settings.projects.empty.title": "아직 작업실이 없습니다",
  "settings.projects.empty.description": "작업실을 추가해 시작하세요",
  "home.project.missing.title": "작업실 폴더를 찾을 수 없습니다",
  "home.project.missing.description": "{{name}}의 폴더가 더 이상 없습니다.",
  "project.settings.folderMissing.title": "작업실 폴더를 찾을 수 없습니다",
  "project.settings.folderMissing.description": "폴더를 되살리거나 이 작업실을 닫으세요.",
  "project.settings.autoAccept.description":
    "이 작업실의 권한 요청을 묻지 않고 승인합니다. 파일 지우기·옮기기와 작업실 밖 파일 고치기는 그래도 묻습니다",
  "project.settings.autoAccept.default.on": "기본값 따르기 (켜짐)",
  "project.settings.autoAccept.default.off": "기본값 따르기 (꺼짐)",
  "project.settings.autoAccept.on": "켜짐",
  "project.settings.autoAccept.off": "꺼짐",
  "command.permissions.autoaccept.project": "이 작업실의 권한 자동 승인",
  "provider.connect.models.title": "{{provider}} 연결됨",
  "provider.connect.models.description": "처음 쓸 모델을 고르세요. 모델은 언제든 바꿀 수 있어요.",
  "provider.connect.models.available": "쓸 수 있는 모델",
  "provider.connect.models.list": "{{provider}}에서 쓸 수 있는 모델",
  "toast.permissions.autoaccept.project.title": "이 작업실의 권한을 자동 승인합니다",
  "toast.permissions.autoaccept.project.description":
    "이 작업실의 권한 요청은 자동으로 승인됩니다. 파일 지우기·옮기기와 작업실 밖 파일 고치기는 그래도 묻습니다",
  "toast.permissions.autoaccept.on.description":
    "권한 요청이 자동으로 승인됩니다. 파일 지우기·옮기기와 작업실 밖 파일 고치기는 그래도 묻습니다",
  "session.location.unavailable": "대화의 작업실 폴더를 찾을 수 없습니다",
  "session.location.description": "이 대화를 이어 갈 다른 폴더를 고르세요.",
  "session.location.choose": "폴더 고르기",
  "session.location.worktree": "작업 공간 고르기",
  "session.location.worktreesFailed": "작업 공간을 불러오지 못했습니다",
  "session.location.moving": "대화를 옮기는 중…",
  "session.location.moveFailed": "대화를 옮기지 못했습니다",
  "dialog.provider.openrouter.note": "키 하나로 여러 회사의 모델을 씁니다 · 음성 받아쓰기에 필요",
  // A conversation not yet sent, and one being made, are 「새 대화창」.
  "session.tab.session": "새 대화창",
  "settings.providers.section.popular": "추천 공급자",
  "dialog.provider.group.popular": "추천",
  "home.providerTip": "OpenRouter 키 하나로 GPT·Gemini·Claude·DeepSeek 등 여러 회사의 모델을 쓸 수 있습니다",
  "settings.tab.about": "정보",
  "settings.timeline.advanced": "고급",
  "settings.general.row.language.description": "자비수 표시 언어 변경",
  "settings.general.row.colorScheme.description": "자비수가 시스템, 라이트 또는 다크 테마를 따를지 선택하세요",
  "settings.general.row.theme.description": "자비수 테마 사용자 지정",
  "desktop.recovery.loadFailed": "자비수를 불러오지 못했습니다",
  "desktop.recovery.terminated": "자비수 창이 예기치 않게 종료되었습니다",
  "desktop.recovery.unresponsive": "자비수가 응답하지 않습니다",
  "project.settings.extensions.empty.mcps.description": "자비수에서 쓸 수 있는 MCP가 여기에 표시됩니다",
  "project.settings.extensions.empty.plugins.description": "자비수에서 쓸 수 있는 플러그인이 여기에 표시됩니다",
  "project.settings.extensions.empty.skills.description": "자비수에서 쓸 수 있는 스킬이 여기에 표시됩니다",
  "settings.workspaces.empty.description": "자비수에서 만든 작업 트리가 여기에 표시됩니다",
}

/** The Korean dictionary as 자비수 shows it. */
export function jabisuKorean<T extends Record<string, unknown>>(dict: T): T {
  const renamed = Object.entries({ ...dict, ...MISSING }).map(([key, value]) => [
    key,
    typeof value === "string" ? jabisuWords(value) : value,
  ])

  return { ...Object.fromEntries(renamed), ...OVERRIDES } as T
}
