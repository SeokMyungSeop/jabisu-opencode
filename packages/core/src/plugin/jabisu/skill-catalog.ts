export * as SkillCatalog from "./skill-catalog.js"

// 자비수's bundled skills as an office worker meets them: a Korean name, what each does, the words someone says when
// they need it, and whether it is on from the start. A skill that is off is installed but not offered to the model;
// the model suggests it when a request matches, and the user turns it on for one chat or for good.

export interface Entry {
  readonly title: string
  readonly summary: string
  readonly keywords: readonly string[]
  readonly on: boolean
}

export const ENTRIES: Readonly<Record<string, Entry>> = {
  hwpx: {
    title: "한글 문서 만들기",
    summary: "한글(.hwpx) 공문을 서식에 맞춰 만들고, 한글 문서를 고치거나 .hwp를 .hwpx로 바꿔요",
    keywords: ["한글", "hwp", "hwpx", "공문", "기안문", "한글 변환"],
    on: true,
  },
  "admin-docs": {
    title: "행정 문서 양식",
    summary: "보고서·메모보고·회의록·출장결과보고·보도자료를 기관 양식의 한글 파일로 만들고 공문서 표기를 검사해요",
    keywords: ["보도자료", "결과보고", "출장보고", "메모보고", "회의록", "계획(안)", "보고서", "표기 검사", "공문서 작성법"],
    on: true,
  },
  docx: {
    title: "워드 문서 만들기",
    summary: "워드(.docx) 문서를 만들거나 고쳐요",
    keywords: ["워드", "word", "docx", "문서"],
    on: true,
  },
  xlsx: {
    title: "엑셀 표 만들기",
    summary: "엑셀(.xlsx) 표를 서식·수식·차트와 함께 만들어요",
    keywords: ["엑셀", "excel", "표", "수식", "차트", "집계"],
    on: true,
  },
  pptx: {
    title: "발표 자료 만들기",
    summary: "파워포인트(.pptx) 발표 자료를 만들어요",
    keywords: ["파워포인트", "ppt", "발표", "슬라이드"],
    on: true,
  },
  "work-profile": {
    title: "내 업무 프로필",
    summary: "사무분장표로 내 업무 프로필을 만들고, 업무가 바뀌면 고쳐요",
    keywords: ["업무 프로필", "사무분장", "업무분장", "담당 업무", "인사이동"],
    on: true,
  },
  "craft-apps": {
    title: "Craft 앱으로 편집",
    summary: "PC에 깔린 Craft 앱으로 영상·소리·사진·PDF를 편집해요",
    keywords: ["영상", "동영상", "자막", "소리", "사진", "PDF 편집", "FilmCraft"],
    on: false,
  },
  handoff: {
    title: "인수인계 정리",
    summary: "일을 멈출 때 다음 사람이 이어받을 정리 문서를 남겨요",
    keywords: ["인수인계", "이어받기", "정리 문서"],
    on: false,
  },
  "diagnosing-bugs": {
    title: "오류 원인 찾기",
    summary: "막히는 프로그램 오류를 재현·가설·확인 순서로 끝까지 추적해요",
    keywords: ["버그", "오류", "에러", "디버그"],
    on: false,
  },
  "grill-me": {
    title: "계획 캐묻기",
    summary: "만들기 전에 계획의 빈틈을 집요하게 질문해요",
    keywords: ["계획 검토", "빈틈", "캐묻기"],
    on: false,
  },
  grilling: {
    title: "결정 캐묻기",
    summary: "계획이나 결정을 하나씩 따져 묻고 확인해요",
    keywords: ["결정 검토", "따져 묻기"],
    on: false,
  },
  tdd: {
    title: "테스트 먼저 개발",
    summary: "프로그램을 만들 때 테스트를 먼저 쓰고 고쳐 나가요",
    keywords: ["테스트", "tdd", "개발"],
    on: false,
  },
  "codebase-design": {
    title: "코드 구조 설계",
    summary: "프로그램 코드를 테스트하기 좋은 구조로 설계해요",
    keywords: ["코드 설계", "구조", "리팩터링"],
    on: false,
  },
}

/** Whether a bundled skill is on: the user's choice, else its default; a skill the catalog lacks is on. */
export const isOn = (name: string, chosen: Readonly<Record<string, boolean>>) =>
  chosen[name] ?? ENTRIES[name]?.on ?? true

/** The instructions that tell the model which bundled skills are off and how to offer them. */
export function offered(names: readonly string[]) {
  if (names.length === 0) return undefined

  return [
    "# 꺼 둔 기본 스킬 (자비수)",
    "",
    "아래 스킬은 설치돼 있지만 꺼져 있다. 사용자의 요청이 그중 하나의 일(괄호 안 낱말)에 해당하면, 파일을 찾거나 다른 방법으로 일을 시작하기 전에 먼저 question 도구로 켤지 묻는다(선택지: 이번 대화만 켜기 / 항상 켜기 / 괜찮아요). 한 대화에서 같은 스킬은 한 번만 묻는다. 이번 대화만이면 skill 도구로 그 ID를 불러 쓰고, 항상 켜기면 skill_turn_on 도구로 켠 뒤 불러 쓴다.",
    "",
    ...names.map((name) => {
      const entry = ENTRIES[name]

      return entry ? `- ${name}: ${entry.summary} (${entry.keywords.join(", ")})` : `- ${name}`
    }),
  ].join("\n")
}
