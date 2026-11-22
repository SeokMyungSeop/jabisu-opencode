// What 자비수 shows once after an update: its own releases, kept in the app so nothing is fetched. Newest first; one
// entry per release, each item a page of the What's New dialog.

export type JabisuHighlight = { readonly title: string; readonly description: string }

export const JABISU_HIGHLIGHTS: readonly { readonly version: string; readonly items: readonly JabisuHighlight[] }[] = [
  {
    version: "1.5.10",
    items: [
      {
        title: "대화를 내용으로 찾고, 이름을 바꿔요",
        description:
          "「대화 검색」(Ctrl+K)이 제목뿐 아니라 대화 안의 말까지 찾아요(두 글자부터). 대화의 ⋯ 메뉴에 「대화 이름 바꾸기」가 생겼고, 작업실의 ⋯ 메뉴에서 「상단 고정」을 누르면 그 작업실이 늘 맨 위에 있어요.",
      },
      {
        title: "작업실을 옮기면 대화도 함께",
        description:
          "작업실의 ⋯ 메뉴에서 「대화 담기」를 누르면 그 작업실의 대화가 폴더 안(.jabisu)에 들어가요. 폴더를 압축해 다른 PC의 자비수에서 열면 대화도 따라와요. 누를 때만 담고, 그 폴더를 남에게 보내면 대화도 함께 가요.",
      },
      {
        title: "다른 AI가 아는 나를 가져오기",
        description:
          "설정 → 환경 설정 → 가져오기에서 문장을 복사해 ChatGPT·Claude·Gemini에 보내고, 받은 답을 붙여 넣으세요. 내 PC의 파일 하나에 적어 두고 모든 대화에서 참고해요.",
      },
      {
        title: "브라우저 로그인이 이어져요",
        description:
          "앱 안의 브라우저에서 한 번 로그인하면, 같은 작업실의 다른 대화에서도 로그인돼 있어요. 로그인은 작업실마다 따로 보관해요.",
      },
      {
        title: "일머리가 처음부터 켜져 있어요",
        description:
          "기본 일머리 16개가 모두 켜진 채 시작해요. 웹 화면을 만들 때 쓰는 「화면 디자인」 일머리가 새로 들어왔고, 설정의 일머리 목록에 초록 「켜짐」 표시가 보여요. 쓰지 않는 일머리는 설정에서 끄면 돼요.",
      },
    ],
  },
  {
    version: "1.5.9",
    items: [
      {
        title: "국산 AI, K-EXAONE 2.5 연결",
        description:
          "LG AI연구원의 K-EXAONE 2.5를 쓸 수 있어요. exaone.ai에서 API 키를 무료로 발급받아 「AI 연결」의 EXAONE에 붙여 넣으세요. 키는 발급일부터 30일 동안 쓸 수 있어요.",
      },
      {
        title: "그려서 설명하기",
        description:
          "「그림으로 설명해 줘」라고 하면 손그림 같은 그림을 그리고, 단계를 하나씩 넘겨 볼 수 있어요. 그림 도구(약 28MB)는 처음 쓸 때 물어본 뒤 내려받아요.",
      },
      {
        title: "화면 말을 우리말로",
        description:
          "스킬은 「일머리」, MCP는 「일손빌림」, 플러그인은 「일머리묶음」이라고 불러요. 하는 일은 그대로이고 이름만 바뀌었어요. 처음 나오는 곳에는 「일머리 (스킬)」처럼 원래 이름도 함께 보여요.",
      },
      {
        title: "법률 번호를 정확하게",
        description:
          "법령을 찾으면 「법률 제21065호」 같은 진짜 공포번호를 함께 알려 줘요. 전에는 법제처 관리 번호를 법률 번호처럼 쓰는 일이 있었어요.",
      },
      {
        title: "업데이트하면 바뀐 점을 알려 줘요",
        description:
          "지금 보시는 이 창이에요. 업데이트한 뒤 한 번만 떠요. 보고 싶지 않으면 「다시 보지 않기」를 누르거나 설정에서 끄세요.",
      },
    ],
  },
]

const MAX = 5

const parts = (version: string) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(version.trim())

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

const compare = (a: readonly number[], b: readonly number[]) =>
  a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

/**
 * The highlights of the releases after `previous` up to `current`, newest first. A version that cannot be read gives
 * none: an unknown order is not shown as news.
 */
export function highlightsSince(previous: string, current: string, list = JABISU_HIGHLIGHTS): JabisuHighlight[] {
  const before = parts(previous)
  const now = parts(current)

  if (!before || !now) return []

  return list
    .flatMap((release) => {
      const version = parts(release.version)

      return version && compare(version, before) > 0 && compare(version, now) <= 0 ? release.items : []
    })
    .slice(0, MAX)
}
