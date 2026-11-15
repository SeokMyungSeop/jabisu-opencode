// What 자비수 shows once after an update: its own releases, kept in the app so nothing is fetched. Newest first; one
// entry per release, each item a page of the What's New dialog.

export type JabisuHighlight = { readonly title: string; readonly description: string }

export const JABISU_HIGHLIGHTS: readonly { readonly version: string; readonly items: readonly JabisuHighlight[] }[] = [
  {
    version: "1.5.9",
    items: [
      {
        title: "국산 AI, K-EXAONE 2.5 연결",
        description:
          "LG AI연구원의 K-EXAONE 2.5를 쓸 수 있어요. exaone.ai에서 API 키를 무료로 발급받아 「AI 연결」의 EXAONE에 붙여 넣으세요. 키는 발급일부터 30일 동안 쓸 수 있어요.",
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
