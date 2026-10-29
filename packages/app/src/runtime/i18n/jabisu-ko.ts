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

// Strings with no Korean translation, or worded for developers or for OpenCode.
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
  "project.settings.autoAccept.description": "이 작업실의 권한 요청을 묻지 않고 승인합니다",
  "project.settings.autoAccept.default.on": "기본값 따르기 (켜짐)",
  "project.settings.autoAccept.default.off": "기본값 따르기 (꺼짐)",
  "project.settings.autoAccept.on": "켜짐",
  "project.settings.autoAccept.off": "꺼짐",
  "command.permissions.autoaccept.project": "이 작업실의 권한 자동 승인",
  "toast.permissions.autoaccept.project.title": "이 작업실의 권한을 자동 승인합니다",
  "toast.permissions.autoaccept.project.description": "이 작업실의 권한 요청은 자동으로 승인됩니다",
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
}

/** The Korean dictionary as 자비수 shows it. */
export function jabisuKorean<T extends Record<string, unknown>>(dict: T): T {
  const renamed = Object.entries(dict).map(([key, value]) => [
    key,
    typeof value === "string" ? jabisuWords(value) : value,
  ])

  return { ...Object.fromEntries(renamed), ...OVERRIDES } as T
}
