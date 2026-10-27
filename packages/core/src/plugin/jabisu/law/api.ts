export * as LawApi from "./api.js"

import { Data, Duration, Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { LawCitation } from "./citation.js"

// The 국가법령정보 공동활용 Open API of 법제처 (law.go.kr): searches and texts of laws, local ordinances,
// administrative rules, court precedents and the ministry's interpretations, read as the JSON it serves. Its JSON
// gives a list of one as a bare object and leaves out empty fields, so each value is read defensively.

export type Kind = "law" | "ordinance" | "rule" | "precedent" | "interpretation"

export const KINDS = ["law", "ordinance", "rule", "precedent", "interpretation"] as const satisfies readonly Kind[]

/** Kinds whose text is made of articles. */
export const STATUTES = ["law", "ordinance", "rule"] as const satisfies readonly Kind[]

export class LawError extends Data.TaggedError("JabisuLawError")<{ readonly reason: string }> {}

/** Calls one endpoint with the given parameters and returns the response text. */
export type Transport = (
  endpoint: "lawSearch.do" | "lawService.do",
  params: Readonly<Record<string, string>>,
) => Effect.Effect<string, LawError>

const BASE = "https://www.law.go.kr/DRF"

const TIMEOUT = Duration.seconds(20)

const TARGETS = {
  law: "law",
  ordinance: "ordin",
  rule: "admrul",
  precedent: "prec",
  interpretation: "expc",
} as const satisfies Record<Kind, string>

/** The transport to law.go.kr with the user's key; the key never appears in what it reports. */
export function transport(http: HttpClient.HttpClient, key: string): Transport {
  const hide = (text: string) => text.replaceAll(key, "***")

  return (endpoint, params) =>
    HttpClientRequest.get(`${BASE}/${endpoint}`).pipe(
      HttpClientRequest.setUrlParams({ OC: key, type: "JSON", ...params }),
      http.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.timeoutOrElse({
        duration: TIMEOUT,
        orElse: () => Effect.fail(new LawError({ reason: "법제처(law.go.kr)가 20초 안에 답하지 않았습니다" })),
      }),
      Effect.mapError((error) =>
        error instanceof LawError
          ? error
          : new LawError({ reason: hide(`법제처(law.go.kr)에 연결하지 못했습니다: ${error.message}`) }),
      ),
      Effect.map(hide),
    )
}

/** A search result: the id the text call takes, its name, and what tells it apart for a person. */
export interface Found {
  readonly kind: Kind
  readonly id: string
  readonly name: string
  readonly short?: string
  readonly detail: string
  readonly current: boolean
}

/** A paragraph (항) of an article and its items (호), each by number. */
export interface Paragraph {
  readonly number: number
  readonly text: string
  readonly items: readonly { readonly number: number; readonly text: string }[]
}

/** An article in its official words: the heading line, its paragraphs, and the whole as text. */
export interface ArticleText {
  readonly article: number
  readonly branch?: number
  readonly heading: string
  readonly paragraphs: readonly Paragraph[]
  readonly text: string
  readonly effective?: string
  readonly deleted: boolean
}

/** A law, ordinance or rule with the articles read, or a precedent or interpretation by its sections. */
export interface Document {
  readonly kind: Kind
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly link: string
  readonly articles: readonly ArticleText[]
  readonly sections: readonly { readonly label: string; readonly text: string }[]
}

type Json = Record<string, unknown>

const record = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined

const list = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])

const str = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(str).join("\n")
  const inner = record(value)?.content

  return inner === undefined ? "" : str(inner)
}

/** 20260918 as official writing has it: 2026. 9. 18. */
export function date(value: string) {
  const digits = value.replace(/\D/g, "")

  if (digits.length !== 8) return value

  return `${Number(digits.slice(0, 4))}. ${Number(digits.slice(4, 6))}. ${Number(digits.slice(6, 8))}.`
}

/** Text from the API with its line-break tags as line breaks and other tags dropped. */
export function clean(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

const parse = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new LawError({ reason: `법제처가 알아볼 수 없는 답을 보냈습니다: ${clean(text).slice(0, 200)}` }),
  })

// law.go.kr refuses a key it cannot verify with its own words, such as that the PC's IP address must be registered
// with the key; the user needs those words to fix it.
const refusal = (root: unknown, fallback: string) => {
  const answer = record(root)
  const words = [str(answer?.["result"]), str(answer?.["msg"])].filter(Boolean).join(" ")

  return new LawError({ reason: words ? `법제처: ${words}` : fallback })
}

const joined = (...parts: readonly string[]) => parts.filter(Boolean).join(" · ")

const since = (value: unknown, word = "시행") => (str(value) ? `${word} ${date(str(value))}` : "")

/** The page on law.go.kr a person opens to read it. */
export function link(kind: Kind, id: string, name: string) {
  switch (kind) {
    // Hangul stays as it is: browsers open it, and percent-encoding triples what the model reads.
    case "law":
      return `https://www.law.go.kr/법령/${LawCitation.key(name)}`
    case "ordinance":
      return `https://www.law.go.kr/자치법규/${LawCitation.key(name)}`
    case "rule":
      return `https://www.law.go.kr/행정규칙/${LawCitation.key(name)}`
    case "precedent":
      return `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`
    case "interpretation":
      return `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${encodeURIComponent(id)}`
  }
}

// Where each kind's results sit in a search answer, and how one becomes a Found.
const SEARCH = {
  law: {
    root: "LawSearch",
    items: "law",
    found: (item: Json) => ({
      id: str(item["법령ID"]),
      name: str(item["법령명한글"]),
      short: str(item["법령약칭명"]),
      detail: joined(str(item["법령구분명"]), str(item["소관부처명"]), since(item["시행일자"])),
      current: str(item["현행연혁코드"]) !== "연혁",
    }),
  },
  ordinance: {
    root: "OrdinSearch",
    items: "law",
    found: (item: Json) => ({
      id: str(item["자치법규일련번호"]),
      name: str(item["자치법규명"]),
      short: "",
      detail: joined(str(item["자치법규종류"]), str(item["지자체기관명"]), since(item["시행일자"])),
      current: true,
    }),
  },
  rule: {
    root: "AdmRulSearch",
    items: "admrul",
    found: (item: Json) => ({
      id: str(item["행정규칙일련번호"]),
      name: str(item["행정규칙명"]),
      short: "",
      detail: joined(
        str(item["행정규칙종류"]),
        str(item["소관부처명"]),
        since(item["발령일자"], "발령"),
        since(item["시행일자"]),
      ),
      current: str(item["현행연혁구분"]) !== "연혁",
    }),
  },
  precedent: {
    root: "PrecSearch",
    items: "prec",
    found: (item: Json) => ({
      id: str(item["판례일련번호"]),
      name: str(item["사건명"]),
      short: "",
      detail: joined(
        str(item["법원명"]),
        str(item["선고일자"]) ? `${date(str(item["선고일자"]))} ${str(item["선고"])}` : "",
        str(item["판결유형"]),
        str(item["사건번호"]),
      ),
      current: true,
    }),
  },
  interpretation: {
    root: "Expc",
    items: "expc",
    found: (item: Json) => ({
      id: str(item["법령해석례일련번호"]),
      name: str(item["안건명"]),
      short: "",
      detail: joined(
        `${str(item["회신기관명"])} 회신 ${str(item["회신일자"])}`.trim(),
        str(item["안건번호"]) ? `안건번호 ${str(item["안건번호"])}` : "",
        str(item["질의기관명"]) ? `질의 ${str(item["질의기관명"])}` : "",
      ),
      current: true,
    }),
  },
} satisfies Record<Kind, { root: string; items: string; found: (item: Json) => Omit<Found, "kind"> }>

/** Searches one kind by name, or by text where `text` is set; precedents are always searched by text. */
export const search = Effect.fn("LawApi.search")(function* (
  call: Transport,
  input: { readonly kind: Kind; readonly query: string; readonly limit: number; readonly text?: boolean },
) {
  const shape = SEARCH[input.kind]
  const root = yield* parse(
    yield* call("lawSearch.do", {
      target: TARGETS[input.kind],
      query: input.query,
      display: String(input.limit),
      ...(input.text || input.kind === "precedent" ? { search: "2" } : {}),
    }),
  )
  const answer = record(record(root)?.[shape.root])

  if (!answer) return yield* refusal(root, "법제처가 검색 결과를 주지 않았습니다. 인증키를 확인하세요.")
  const found = list(answer[shape.items]).flatMap((item) => {
    const value = record(item)

    if (!value) return []
    const { short, ...rest } = shape.found(value)

    return rest.id && rest.name ? [{ kind: input.kind, ...rest, ...(short ? { short } : {}) } satisfies Found] : []
  })

  return { total: Number(str(answer["totalCnt"])) || found.length, found }
})

const CIRCLED = /^[①-⑳]/

/** ① is 1 and ⑳ is 20. */
const circled = (text: string) => {
  const mark = CIRCLED.exec(text.trim())?.[0]

  return mark ? mark.charCodeAt(0) - 0x2460 + 1 : undefined
}

const leading = (text: string) => Number(/^\s*(\d+)/.exec(text)?.[1] ?? Number.NaN)

const isDeleted = (text: string) => /^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?\s*삭제/.test(text)

// A law's article from the API's structured 항, 호 and 목.
const lawArticle = (unit: Json): ArticleText => {
  const heading = clean(str(unit["조문내용"]))
  const paragraphs = list(unit["항"]).flatMap((value) => {
    const item = record(value)

    if (!item) return []
    const text = clean(str(item["항내용"]))
    const items = list(item["호"]).flatMap((entry) => {
      const ho = record(entry)

      if (!ho) return []
      const subitems = list(ho["목"]).map((mok) => clean(str(record(mok)?.["목내용"])))

      return [{ number: leading(str(ho["호번호"])), text: [clean(str(ho["호내용"])), ...subitems].join("\n") }]
    })

    return [{ number: circled(str(item["항번호"]) || text) ?? 0, text, items }]
  })
  const branch = Number(str(unit["조문가지번호"])) || undefined

  return {
    article: Number(str(unit["조문번호"])),
    ...(branch ? { branch } : {}),
    heading,
    paragraphs,
    text: [heading, ...paragraphs.flatMap((item) => [item.text, ...item.items.map((ho) => `  ${ho.text}`)])]
      .filter((line) => line.trim())
      .join("\n"),
    ...(str(unit["조문시행일자"]) ? { effective: date(str(unit["조문시행일자"])) } : {}),
    deleted: isDeleted(heading),
  }
}

const HEADING = /^제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*\([^)]*\))?/

// Items in text that runs them together, as 다음 각 호와 같다.1. 가2. 나: 1., 2., 3. in order, each where the last
// ended and not part of a larger number.
const itemsOf = (text: string) => {
  const items: { number: number; start: number; end: number }[] = []

  for (let number = 1, from = 0; ; number++) {
    const found = new RegExp(`(?<!\\d)${number}\\.\\s`, "g")
    found.lastIndex = from
    const match = found.exec(text)

    if (!match) break
    items.push({ number, start: match.index, end: match.index + match[0].length })
    from = match.index + match[0].length
  }

  return items.map((item, index) => ({
    number: item.number,
    text: text.slice(item.start, items[index + 1]?.start ?? text.length).trim(),
  }))
}

// An ordinance's or rule's article from its text alone: paragraphs start with ①, items with 1.
const textArticle = (text: string, code?: string): ArticleText | undefined => {
  const body = clean(text)
  const heading = HEADING.exec(body)?.[0]
  const ref = heading ? LawCitation.article(/^제\s*\d+\s*조(?:\s*의\s*\d+)?/.exec(heading)?.[0] ?? "") : undefined
  const fromCode = code && /^\d{6}$/.test(code) ? { article: Number(code.slice(0, 4)), branch: Number(code.slice(4)) } : undefined
  const article = ref ?? fromCode

  if (!article) return undefined
  const rest = heading ? body.slice(heading.length) : body
  const parts = rest.split(/(?=[①-⑳])/).filter((part) => part.trim())
  const paragraphs = parts.map((part) => ({ number: circled(part) ?? 0, text: part.trim(), items: itemsOf(part) }))

  return {
    article: article.article,
    ...(article.branch ? { branch: article.branch } : {}),
    heading: heading ?? LawCitation.label(article),
    paragraphs,
    text: body,
    deleted: isDeleted(body),
  }
}

// How each kind's text is read: its basic information and its articles or sections.
const readers = {
  law: (root: Json, id: string) => {
    const law = record(root["법령"])
    const info = record(law?.["기본정보"])

    if (!law || !info) return undefined
    const name = str(info["법령명_한글"])
    const units = list(record(law["조문"])?.["조문단위"]).flatMap((value) => {
      const unit = record(value)

      return unit && str(unit["조문여부"]) === "조문" ? [lawArticle(unit)] : []
    })

    return {
      name,
      detail: joined(str(info["법종구분"]), str(info["소관부처"]), since(info["시행일자"])),
      link: link("law", id, name),
      articles: units,
      sections: [],
    }
  },
  ordinance: (root: Json, id: string) => {
    const service = record(root["LawService"])
    const info = record(service?.["자치법규기본정보"])

    if (!service || !info) return undefined
    const name = str(info["자치법규명"])
    const articles = list(record(service["조문"])?.["조"]).flatMap((value) => {
      const unit = record(value)
      const article = unit ? textArticle(str(unit["조내용"]), list(unit["조문번호"]).map(str)[0]) : undefined

      return article ? [article] : []
    })

    return {
      name,
      detail: joined(str(info["지자체기관명"]), since(info["시행일자"])),
      link: link("ordinance", id, name),
      articles,
      sections: [],
    }
  },
  rule: (root: Json, id: string) => {
    const service = record(root["AdmRulService"])
    const info = record(service?.["행정규칙기본정보"])

    if (!service || !info) return undefined
    const name = str(info["행정규칙명"])
    const articles = list(service["조문내용"]).flatMap((value) => {
      const article = textArticle(str(value))

      return article ? [article] : []
    })

    return {
      name,
      detail: joined(
        str(info["행정규칙종류"]),
        str(info["소관부처명"]),
        since(info["발령일자"], "발령"),
        since(info["시행일자"]),
      ),
      link: link("rule", id, name),
      articles,
      // A rule written without articles, such as a 고시 of figures, is read as its text.
      sections: articles.length
        ? []
        : list(service["조문내용"]).map((value) => ({ label: "본문", text: clean(str(value)) })),
    }
  },
  precedent: (root: Json, id: string) => {
    const service = record(root["PrecService"])

    if (!service) return undefined
    const name = str(service["사건명"])

    return {
      name,
      detail: joined(
        str(service["법원명"]),
        str(service["선고일자"]) ? `${date(str(service["선고일자"]))} ${str(service["선고"])}` : "",
        str(service["판결유형"]),
        str(service["사건번호"]),
      ),
      link: link("precedent", id, name),
      articles: [],
      sections: (["판시사항", "판결요지", "참조조문", "참조판례", "판례내용"] as const).flatMap((label) => {
        const text = clean(str(service[label]))

        return text ? [{ label, text }] : []
      }),
    }
  },
  interpretation: (root: Json, id: string) => {
    const service = record(root["ExpcService"])

    if (!service) return undefined
    const name = str(service["안건명"])

    return {
      name,
      detail: joined(
        `${str(service["해석기관명"])} 회신 ${date(str(service["해석일자"]))}`.trim(),
        str(service["안건번호"]) ? `안건번호 ${str(service["안건번호"])}` : "",
        str(service["질의기관명"]) ? `질의 ${str(service["질의기관명"])}` : "",
      ),
      link: link("interpretation", id, name),
      articles: [],
      sections: (["질의요지", "회답", "이유"] as const).flatMap((label) => {
        const text = clean(str(service[label]))

        return text ? [{ label, text }] : []
      }),
    }
  },
} satisfies Record<Kind, (root: Json, id: string) => Omit<Document, "kind" | "id"> | undefined>

// The parameter each kind's text is asked for by: a law by its id across versions, the others by the serial number
// their search gave.
const ID_PARAMETER = {
  law: "ID",
  ordinance: "MST",
  rule: "ID",
  precedent: "ID",
  interpretation: "ID",
} as const satisfies Record<Kind, string>

/**
 * One document. A law can be asked for one article (`article`, the six-digit code), which keeps a long law's answer
 * small; the others always come whole.
 */
export const document = Effect.fn("LawApi.document")(function* (
  call: Transport,
  input: { readonly kind: Kind; readonly id: string; readonly article?: string },
) {
  const root = record(
    yield* parse(
      yield* call("lawService.do", {
        target: TARGETS[input.kind],
        [ID_PARAMETER[input.kind]]: input.id,
        ...(input.kind === "law" && input.article ? { JO: input.article } : {}),
      }),
    ),
  )
  const read = root ? readers[input.kind](root, input.id) : undefined

  if (!read) return yield* refusal(root, `법제처에서 ${input.id}의 본문을 찾지 못했습니다`)

  return { kind: input.kind, id: input.id, ...read } satisfies Document
})
