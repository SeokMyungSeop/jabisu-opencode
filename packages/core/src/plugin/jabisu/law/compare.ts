export * as LawCompare from "./compare.js"

import { Effect } from "effect"
import { LawApi } from "./api.js"
import { LawCitation } from "./citation.js"

// What law.go.kr works out about one law beyond its text: what its latest amendment changed (신구법 비교), the decree
// and rule articles that carry out each of its articles (3단 비교), the laws and rules made under it or above it
// (법령 체계도), and its versions over time (연혁), from which the one in force on a date is read. Each is asked for by
// the law's id, the one law_search gives. A local ordinance is checked against the laws it carries out the same way.

const { clean, joined, list, parse, record, records, refusal, since, str } = LawApi

/** One version of a law as these answers describe it. */
const version = (info: LawApi.Json | undefined) =>
  info
    ? joined(
        str(info["법종구분"]) && str(info["공포번호"]) ? `${str(info["법종구분"])} 제${str(info["공포번호"])}호` : "",
        since(info["공포일자"], "공포"),
        since(info["시행일자"]),
        str(info["제개정구분명"]),
      )
    : ""

/** What the latest amendment changed: the two latest versions and each changed line before and after, by article. */
export interface Changes {
  readonly name: string
  readonly before: string
  readonly after: string
  readonly pairs: readonly { readonly article: string; readonly before: string; readonly after: string }[]
}

// Lines the comparison keeps only to place the changed ones, such as 1. ∼ 9. (생 략) or ②·③ (현행과 같음).
const unchanged = (text: string) => /^\s*[^()]{0,24}\((?:현행과\s*같음|생\s*략)\)\s*$/.test(text)

const ARTICLE_HEADING = /^제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*\([^)]*\))?/

export const changes = Effect.fn("LawCompare.changes")(function* (call: LawApi.Transport, id: string) {
  const root = record(yield* parse(yield* call("lawService.do", { target: "oldAndNew", ID: id })))
  const service = record(root?.["OldAndNewService"])

  if (!service) return yield* refusal(root, `법제처에서 ${id}의 신구법 비교를 찾지 못했습니다`)
  const lines = (side: string) =>
    new Map(
      list(record(service[side])?.["조문"]).flatMap((value) => {
        const line = record(value)

        return line ? [[str(line["no"]), clean(str(line["content"]))] as const] : []
      }),
    )
  const before = lines("구조문목록")
  const after = lines("신조문목록")
  const numbers = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => Number(a) - Number(b))
  const info = record(service["신조문_기본정보"])
  // The lines run in order, each article's first line starting with its heading.
  let article = ""

  return {
    name: str(info?.["법령명"]),
    before: version(record(service["구조문_기본정보"])),
    after: version(info),
    pairs: numbers.flatMap((number) => {
      const old = before.get(number) ?? ""
      const now = after.get(number) ?? ""
      article = (ARTICLE_HEADING.exec(now) ?? ARTICLE_HEADING.exec(old))?.[0] ?? article

      return old === now || (unchanged(old) && unchanged(now)) ? [] : [{ article, before: old, after: now }]
    }),
  } satisfies Changes
})

/** An article of a decree or rule that carries out an article of the law. */
export interface Linked {
  readonly level: "시행령" | "시행규칙"
  readonly heading: string
  readonly text: string
}

/** The law's articles, each with the decree and rule articles that refer to it. */
export interface Delegation {
  readonly name: string
  readonly decree: string
  readonly rule: string
  readonly articles: readonly {
    readonly article: number
    readonly branch?: number
    readonly heading: string
    readonly text: string
    readonly linked: readonly Linked[]
  }[]
}

const linkedOf = (unit: LawApi.Json, level: Linked["level"]) =>
  list(record(unit[`${level}조문목록`])?.[`${level}조문`]).flatMap((value) => {
    const linked = record(value)

    return linked && str(linked["조제목"])
      ? [{ level, heading: clean(str(linked["조제목"])), text: clean(str(linked["조내용"])) } satisfies Linked]
      : []
  })

export const delegation = Effect.fn("LawCompare.delegation")(function* (call: LawApi.Transport, id: string) {
  const root = record(yield* parse(yield* call("lawService.do", { target: "thdCmp", ID: id, knd: "1" })))
  const service = record(root?.["ThdCmpLawXService"])
  const info = record(service?.["기본정보"])

  if (!service || !info) return yield* refusal(root, `법제처에서 ${id}의 3단 비교를 찾지 못했습니다`)

  return {
    name: str(info["법령명"]),
    decree: joined(str(info["시행령명"]), str(info["시행령요약정보"])),
    rule: joined(str(info["시행규칙명"]), str(info["시행규칙요약정보"])),
    // Chapter headings come as articles without a heading of their own.
    articles: list(record(service["인용조문삼단비교"])?.["법률조문"]).flatMap((value) => {
      const unit = record(value)

      if (!unit || !str(unit["조제목"])) return []
      const branch = Number(str(unit["조가지번호"])) || undefined

      return [
        {
          article: Number(str(unit["조번호"])),
          ...(branch ? { branch } : {}),
          heading: clean(str(unit["조제목"])),
          text: clean(str(unit["조내용"])),
          linked: [...linkedOf(unit, "시행령"), ...linkedOf(unit, "시행규칙")],
        },
      ]
    }),
  } satisfies Delegation
})

/** A law or rule made under the law, where it sits, and the id law_text reads it by. */
export interface Below {
  readonly path: string
  readonly kind: "law" | "rule"
  readonly id: string
  readonly name: string
  readonly detail: string
}

export interface System {
  readonly name: string
  readonly detail: string
  readonly below: readonly Below[]
}

export const system = Effect.fn("LawCompare.system")(function* (call: LawApi.Transport, id: string) {
  const root = record(yield* parse(yield* call("lawService.do", { target: "lsStmd", ID: id })))
  const service = record(root?.["법령체계도"])
  const info = record(service?.["기본정보"])

  if (!service || !info) return yield* refusal(root, `법제처에서 ${id}의 법령 체계도를 찾지 못했습니다`)
  const below: Below[] = []
  const seen = new Set<string>()
  // The tree nests each level under the one above (법률 > 시행령 > 시행규칙), with rules grouped by their kind.
  const walk = (value: unknown, path: readonly string[]): void => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, path))
    const node = record(value)

    if (!node) return
    const basic = record(node["기본정보"])
    const rule = str(basic?.["행정규칙명"])
    const law = str(basic?.["법령명"])

    // Every law and rule in the tree but the law asked about; above it when it is a decree or rule itself.
    if (basic && (rule || law) && str(basic["법령ID"]) !== id) {
      const entry = rule
        ? {
            path: path.join(" > "),
            kind: "rule" as const,
            id: str(basic["행정규칙일련번호"]),
            name: rule,
            detail: joined(str(basic["법종구분"]), since(basic["발령일자"], "발령")),
          }
        : {
            path: path.join(" > "),
            kind: "law" as const,
            id: str(basic["법령ID"]),
            name: law,
            detail: joined(str(basic["법종구분"]), since(basic["시행일자"])),
          }

      if (!seen.has(`${entry.path}\0${entry.name}`)) {
        seen.add(`${entry.path}\0${entry.name}`)
        below.push(entry)
      }
    }
    for (const [key, inner] of Object.entries(node)) if (key !== "기본정보") walk(inner, [...path, key])
  }
  walk(service["상하위법"], [])

  return {
    name: str(info["법령명"]),
    detail: joined(str(info["법종구분"]), since(info["시행일자"])),
    below,
  } satisfies System
})

/** A version of a law: its serial number (MST), when it was promulgated and took effect, and what it was. */
export interface Version {
  readonly mst: string
  readonly name: string
  readonly kind: string
  readonly number: string
  readonly promulgated: string
  readonly effective: string
  readonly change: string
  readonly status: string
}

// A long-lived decree has a few hundred versions; law.go.kr gives 100 a page.
const PAGE = 100
const MAX_PAGES = 5

/**
 * Every version of a law, newest first by the date it took effect. law.go.kr lists one per date a promulgation takes
 * effect on, so an amendment taking effect in stages appears once per stage, and renamed versions keep the law's id.
 */
export const versions = Effect.fn("LawCompare.versions")(function* (call: LawApi.Transport, id: string) {
  const rows: Version[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const root = yield* parse(
      yield* call("lawSearch.do", { target: "eflaw", LID: id, nw: "1,2,3", display: String(PAGE), page: String(page) }),
    )
    const answer = record(record(root)?.["LawSearch"])

    if (!answer) return yield* refusal(root, `법제처에서 ${id}의 연혁을 찾지 못했습니다`)
    const items = list(answer["law"]).flatMap((value) => {
      const item = record(value)

      // law.go.kr ignores an id it does not know and lists every law; only this law's versions count.
      return item && str(item["법령ID"]).replace(/^0+/, "") === id.replace(/^0+/, "")
        ? [
            {
              mst: str(item["법령일련번호"]),
              name: str(item["법령명한글"]),
              kind: str(item["법령구분명"]),
              number: str(item["공포번호"]).replace(/^0+(?=\d)/, ""),
              promulgated: str(item["공포일자"]),
              effective: str(item["시행일자"]),
              change: str(item["제개정구분명"]),
              status: str(item["현행연혁코드"]),
            } satisfies Version,
          ]
        : []
    })

    rows.push(...items)
    if (items.length < PAGE || rows.length >= Number(str(answer["totalCnt"]))) break
  }

  return rows.sort(
    (a, b) =>
      b.effective.localeCompare(a.effective) ||
      b.promulgated.localeCompare(a.promulgated) ||
      Number(b.number) - Number(a.number),
  )
})

/** A local ordinance with the laws it says, in its purpose article, that it carries out. */
export interface Ordinance {
  readonly name: string
  readonly effective: string
  readonly detail: string
  readonly purpose: string
  readonly laws: readonly string[]
}

// The laws an ordinance carries out, as its purpose article names them: 「주차장법」, 같은 법 시행령 및 시행규칙. Other
// articles and annexes cite laws for other reasons, such as who is exempt from a fee, so only that article counts.
export function basis(purpose: string, self: string) {
  const names: string[] = []
  const add = (name: string) => {
    if (
      LawCitation.key(name) !== LawCitation.key(self) &&
      !names.some((item) => LawCitation.key(item) === LawCitation.key(name))
    )
      names.push(name)
  }
  let base = ""

  for (const match of purpose.matchAll(
    /「([^「」]+)」|같은\s*법\s*(시행령|시행규칙)(?:\s*(?:및|[·ㆍ,])\s*(시행령|시행규칙))?/g,
  )) {
    if (!match[1]) {
      for (const level of [match[2], match[3]]) if (base && level) add(`${base} ${level}`)
      continue
    }
    const name = match[1].trim()

    if (!/(법|법률|시행령|시행규칙|령|규칙|규정)$/.test(name)) continue
    const law = name.replace(/\s*(시행령|시행규칙)$/, "")

    if (/(법|법률)$/.test(law)) base = law
    add(name)
  }

  return names
}

export const ordinance = Effect.fn("LawCompare.ordinance")(function* (call: LawApi.Transport, id: string) {
  const root = record(yield* parse(yield* call("lawService.do", { target: "ordin", MST: id })))
  const service = record(root?.["LawService"])
  const info = record(service?.["자치법규기본정보"])

  if (!service || !info) return yield* refusal(root, `법제처에서 자치법규 ${id}을(를) 찾지 못했습니다`)
  const articles = records(record(service["조문"])?.["조"])
  const purpose =
    articles.find((item) => str(item["조제목"]).includes("목적")) ??
    articles.find((item) => str(item["조문여부"]) === "Y") ??
    articles[0]
  const name = str(info["자치법규명"])
  const text = clean(str(purpose?.["조내용"]))

  return {
    name,
    effective: str(info["시행일자"]),
    detail: joined(str(info["지자체기관명"]), str(info["담당부서명"]), since(info["시행일자"])),
    purpose: text,
    laws: basis(text, name),
  } satisfies Ordinance
})

/** YYYYMMDD from a date as people write it: 2024-01-01, 2024. 1. 1. or 20240101; none when it is not a date. */
export function day(text: string) {
  const parts = /^\s*(\d{4})\D*?(\d{1,2})\D*?(\d{1,2})\D*$/.exec(text)

  if (!parts) return undefined
  const [year, month, date] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]

  return month >= 1 && month <= 12 && date >= 1 && date <= 31
    ? `${year}${String(month).padStart(2, "0")}${String(date).padStart(2, "0")}`
    : undefined
}

/** The version in force on a day: the newest to take effect on or before it; none before the first. */
export const inForce = (rows: readonly Version[], on: string) => rows.find((row) => row.effective <= on)

/** Whether an article of the law is the one a reference names. */
export const isArticle = (item: { readonly article: number; readonly branch?: number }, ref: LawCitation.Article) =>
  item.article === ref.article && (item.branch ?? 0) === (ref.branch ?? 0)
