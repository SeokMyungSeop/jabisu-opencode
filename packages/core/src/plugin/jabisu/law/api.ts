export * as LawApi from "./api.js"

import { Data, Duration, Effect, Schedule } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { LawCitation } from "./citation.js"

// The 국가법령정보 공동활용 Open API of 법제처 (law.go.kr): searches and texts of laws, local ordinances,
// administrative rules, court precedents and the ministry's interpretations; decisions of the Constitutional Court, of
// administrative appeals and of committees; the annexes and forms of laws; treaties, English translations and legal
// terms; read as the JSON it serves. Its JSON gives a list of one as a bare object and leaves out empty fields, so
// each value is read defensively.

export const KINDS = [
  "law",
  "ordinance",
  "rule",
  "precedent",
  "interpretation",
  "constitutional",
  "appeal",
  "tax_appeal",
  "fair_trade",
  "anti_corruption",
  "labor",
  "privacy",
  "accident_insurance",
  "employment_insurance",
  "civil_service",
  "special_appeal",
  "customs",
  "labor_ministry",
  "annex",
  "rule_annex",
  "ordinance_annex",
  "treaty",
  "english",
  "term",
  "school",
  "public_corp",
  "public_institution",
] as const

export type Kind = (typeof KINDS)[number]

/** Kinds found by their exact name and read by article. */
export const STATUTES = ["law", "ordinance", "rule"] as const satisfies readonly Kind[]

/** Kinds whose text is made of articles. */
export const ARTICLED = [
  ...STATUTES,
  "english",
  "school",
  "public_corp",
  "public_institution",
] as const satisfies readonly Kind[]

/** The annexes and forms (별표·서식) of laws, rules and ordinances, read from the files law.go.kr keeps. */
export const ANNEXES = ["annex", "rule_annex", "ordinance_annex"] as const satisfies readonly Kind[]

export class LawError extends Data.TaggedError("JabisuLawError")<{ readonly reason: string }> {}

/** Calls one endpoint with the given parameters and returns the response text. */
export type Transport = (
  endpoint: "lawSearch.do" | "lawService.do",
  params: Readonly<Record<string, string>>,
) => Effect.Effect<string, LawError>

/** Fetches a file law.go.kr links to, such as an annex's Hangul file, by its path on the site. */
export type Download = (path: string) => Effect.Effect<Uint8Array, LawError>

const SITE = "https://www.law.go.kr"

const BASE = `${SITE}/DRF`

const TIMEOUT = Duration.seconds(20)

// An annex file is a page or two of a form; this is far more than any.
const MAX_FILE_BYTES = 20 * 1024 * 1024

const TARGETS = {
  law: "law",
  ordinance: "ordin",
  rule: "admrul",
  precedent: "prec",
  interpretation: "expc",
  constitutional: "detc",
  appeal: "decc",
  tax_appeal: "ttSpecialDecc",
  fair_trade: "ftc",
  anti_corruption: "acr",
  labor: "nlrc",
  privacy: "ppc",
  accident_insurance: "iaciac",
  employment_insurance: "eiac",
  civil_service: "adapSpecialDecc",
  special_appeal: "acrSpecialDecc",
  customs: "kcsCgmExpc",
  labor_ministry: "moelCgmExpc",
  annex: "licbyl",
  rule_annex: "admbyl",
  ordinance_annex: "ordinbyl",
  treaty: "trty",
  english: "elaw",
  term: "lstrm",
  school: "school",
  public_corp: "public",
  public_institution: "pi",
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
      // law.go.kr now and then refuses one of several quick calls with 404; the same call then succeeds.
      Effect.retry({ times: 2, schedule: Schedule.spaced(Duration.millis(300)) }),
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

/** Downloads from law.go.kr's site, which serves its files without the key. */
export function download(http: HttpClient.HttpClient): Download {
  return (path) =>
    HttpClientRequest.get(`${SITE}${path}`).pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.timeoutOrElse({
        duration: TIMEOUT,
        orElse: () => Effect.fail(new LawError({ reason: "법제처(law.go.kr)가 20초 안에 파일을 주지 않았습니다" })),
      }),
      Effect.mapError((error) =>
        error instanceof LawError
          ? error
          : new LawError({ reason: `법제처(law.go.kr)에서 파일을 받지 못했습니다: ${error.message}` }),
      ),
      Effect.filterOrFail(
        (buffer) => buffer.byteLength <= MAX_FILE_BYTES,
        () => new LawError({ reason: "법제처(law.go.kr)의 파일이 너무 큽니다" }),
      ),
      Effect.map((buffer) => new Uint8Array(buffer)),
    )
}

/** An annex's files on law.go.kr, by their paths on the site: the Hangul file and the PDF. */
export interface Files {
  readonly hwp?: string
  readonly pdf?: string
}

/** A search result: the id the text call takes, its name, and what tells it apart for a person. */
export interface Found {
  readonly kind: Kind
  readonly id: string
  readonly name: string
  readonly short?: string
  readonly detail: string
  readonly current: boolean
  readonly files?: Files
  /** An ordinance's 지자체기관명, such as 경기도 수원시. */
  readonly org?: string
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

/** A text with its articles read, or a decision, treaty or term by its sections. */
export interface Document {
  readonly kind: Kind
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly link: string
  readonly articles: readonly ArticleText[]
  readonly sections: readonly { readonly label: string; readonly text: string }[]
}

export type Json = Record<string, unknown>

export const record = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined

export const list = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]

/** The objects in a value that is one object or a list of them. */
export const records = (value: unknown): Json[] =>
  list(value).flatMap((item) => {
    const found = record(item)

    return found ? [found] : []
  })

export const str = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(str).join("\n")
  const inner = record(value)?.content

  return inner === undefined ? "" : str(inner)
}

/** 20260918 or 2026.9.18. as official writing has it: 2026. 9. 18. */
export function date(value: string) {
  const digits = value.replace(/\D/g, "")

  if (digits.length === 8)
    return `${Number(digits.slice(0, 4))}. ${Number(digits.slice(4, 6))}. ${Number(digits.slice(6, 8))}.`
  const parts = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/.exec(value.trim())

  return parts ? `${Number(parts[1])}. ${Number(parts[2])}. ${Number(parts[3])}.` : value
}

/**
 * Text from the API with its line-break tags as line breaks and other tags dropped: hidden copies of a heading go, and
 * a footnote mark becomes [각주N].
 */
export function clean(text: string) {
  return text
    .replace(/<span[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<각주>\s*(\d+)\s*<\/각주>/g, "[각주$1]")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&sim;/g, "∼")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

/** The key's application covers each kind of data separately; law.go.kr says so in a page of its own. */
export const NOT_APPLIED =
  "법제처: 이 인증키로 신청하지 않은 자료입니다. open.law.go.kr → 마이페이지 → OPEN API 신청에서 이 자료(목록과 본문)를 추가로 신청하세요."

// law.go.kr answers with 200 whatever happens: an empty body when there is no such record, and a page of words when
// the key may not read this kind of data.
export const parse = (text: string) => {
  if (!text.trim()) return Effect.fail(new LawError({ reason: "법제처에 그 자료가 없습니다. id를 확인하세요." }))
  if (text.includes("미신청된 목록/본문")) return Effect.fail(new LawError({ reason: NOT_APPLIED }))

  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new LawError({ reason: `법제처가 알아볼 수 없는 답을 보냈습니다: ${clean(text).slice(0, 200)}` }),
  })
}

// law.go.kr refuses a key it cannot verify with its own words, such as that the PC's IP address must be registered
// with the key; the user needs those words to fix it.
export const refusal = (root: unknown, fallback: string) => {
  const answer = record(root)
  const words = [str(answer?.["result"]), str(answer?.["msg"])].filter(Boolean).join(" ")

  return new LawError({ reason: words ? `법제처: ${words}` : fallback })
}

export const joined = (...parts: readonly string[]) => parts.filter(Boolean).join(" · ")

export const since = (value: unknown, word = "시행") => (str(value) ? `${word} ${date(str(value))}` : "")

// Committees space out the letters of short words, as 의 결 or 국 민 권 익 위 원 회.
const squeeze = (value: unknown) => {
  const text = clean(str(value))

  return /^(?:[가-힣] )+[가-힣]$/.test(text) ? text.replaceAll(" ", "") : text
}

/** The page on law.go.kr a person opens to read it; its home page where it has no page of its own. */
export function link(kind: Kind, id: string, name: string, files?: Files) {
  switch (kind) {
    // Hangul stays as it is: browsers open it, and percent-encoding triples what the model reads.
    case "law":
      return `${SITE}/법령/${LawCitation.key(name)}`
    case "ordinance":
      return `${SITE}/자치법규/${LawCitation.key(name)}`
    case "rule":
      return `${SITE}/행정규칙/${LawCitation.key(name)}`
    case "precedent":
      return `${SITE}/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`
    case "interpretation":
      return `${SITE}/LSW/expcInfoP.do?expcSeq=${encodeURIComponent(id)}`
    case "constitutional":
      return `${SITE}/LSW/detcInfoP.do?detcSeq=${encodeURIComponent(id)}`
    case "appeal":
      return `${SITE}/LSW/deccInfoP.do?deccSeq=${encodeURIComponent(id)}`
    case "treaty":
      return `${SITE}/LSW/trtyInfoP.do?trtySeq=${encodeURIComponent(id)}`
    case "term":
      return `${SITE}/LSW/lsTrmInfoR.do?trmSeqs=${encodeURIComponent(id)}`
    case "annex":
    case "rule_annex":
    case "ordinance_annex": {
      const path = files?.hwp ?? files?.pdf

      return path ? `${SITE}${path}` : SITE
    }
    default:
      return SITE
  }
}

/** How an annex is named in official writing: 별표 3의2, or 별지 제18호서식 for a form. */
const annexLabel = (item: Json) => {
  const code = str(item["별표번호"])
  const kind = str(item["별표종류"])

  if (!/^\d{6}$/.test(code)) return kind
  const number = `${Number(code.slice(0, 4))}${Number(code.slice(4)) ? `의${Number(code.slice(4))}` : ""}`

  if (kind === "서식" || kind === "별지") return `별지 제${number}호서식`

  return `${kind || "별표"} ${number}`
}

const annexFiles = (item: Json): Files | undefined => {
  const hwp = str(item["별표서식파일링크"])
  const pdf = str(item["별표서식PDF파일링크"])

  return hwp || pdf ? { ...(hwp ? { hwp } : {}), ...(pdf ? { pdf } : {}) } : undefined
}

// The administrative rules and the rules of schools and public bodies, which law.go.kr lists alike.
const ruleFound = (item: Json) => ({
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
})

// The decisions of special administrative appeal bodies, such as the tax tribunal and the civil service appeal
// commissions, which law.go.kr lists alike.
const specialFound = (item: Json) => ({
  id: str(item["특별행정심판재결례일련번호"]),
  name: clean(str(item["사건명"])),
  short: "",
  detail: joined(str(item["재결청"]), str(item["청구번호"]) || str(item["사건번호"]), since(item["의결일자"], "의결")),
  current: true,
})

// A ministry's own interpretations of the laws it runs, which law.go.kr lists alike for each ministry.
const ministryFound = (item: Json) => ({
  id: str(item["법령해석일련번호"]),
  name: clean(str(item["안건명"])),
  short: "",
  detail: joined(
    `${str(item["해석기관명"])} 회신 ${date(str(item["해석일자"]))}`.trim(),
    str(item["안건번호"]) ? `안건번호 ${str(item["안건번호"])}` : "",
    str(item["질의기관명"]) ? `질의 ${str(item["질의기관명"])}` : "",
  ),
  current: true,
})

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
      org: str(item["지자체기관명"]),
    }),
  },
  rule: { root: "AdmRulSearch", items: "admrul", found: ruleFound },
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
  constitutional: {
    root: "DetcSearch",
    items: "Detc",
    found: (item: Json) => ({
      id: str(item["헌재결정례일련번호"]),
      name: clean(str(item["사건명"])),
      short: "",
      detail: joined(`헌법재판소 ${str(item["사건번호"])}`.trim(), since(item["종국일자"], "종국")),
      current: true,
    }),
  },
  appeal: {
    root: "Decc",
    items: "decc",
    found: (item: Json) => ({
      id: str(item["행정심판재결례일련번호"]),
      name: clean(str(item["사건명"])),
      short: "",
      detail: joined(str(item["재결청"]), since(item["의결일자"], "의결"), str(item["사건번호"])),
      current: true,
    }),
  },
  tax_appeal: { root: "Decc", items: "decc", found: specialFound },
  fair_trade: {
    root: "Ftc",
    items: "ftc",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["사건명"])),
      short: "",
      detail: joined(
        "공정거래위원회",
        squeeze(item["문서유형"]),
        clean(str(item["결정번호"])),
        since(item["결정일자"], "결정"),
        str(item["사건번호"]),
      ),
      current: true,
    }),
  },
  anti_corruption: {
    root: "Acr",
    items: "acr",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["제목"])),
      short: "",
      detail: joined("국민권익위원회", str(item["의안번호"]), since(item["의결일"], "의결"), squeeze(item["결정구분"])),
      current: true,
    }),
  },
  labor: {
    root: "Nlrc",
    items: "nlrc",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["제목"])),
      short: "",
      detail: joined("노동위원회", str(item["사건번호"]), since(item["등록일"], "등록")),
      current: true,
    }),
  },
  privacy: {
    root: "Ppc",
    items: "ppc",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["안건명"])),
      short: "",
      detail: joined(
        "개인정보보호위원회",
        str(item["의안번호"]),
        since(item["의결일"], "의결"),
        squeeze(item["결정구분"]),
      ),
      current: true,
    }),
  },
  accident_insurance: {
    root: "Iaciac",
    items: "iaciac",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["사건"])),
      short: "",
      detail: joined("산업재해보상보험재심사위원회", since(item["의결일자"], "의결")),
      current: true,
    }),
  },
  employment_insurance: {
    root: "Eiac",
    items: "eiac",
    found: (item: Json) => ({
      id: str(item["결정문일련번호"]),
      name: clean(str(item["사건명"])),
      short: "",
      detail: joined("고용보험심사위원회", str(item["사건번호"]), since(item["의결일자"], "의결")),
      current: true,
    }),
  },
  civil_service: { root: "Decc", items: "decc", found: specialFound },
  special_appeal: { root: "Decc", items: "decc", found: specialFound },
  customs: { root: "CgmExpc", items: "cgmExpc", found: ministryFound },
  labor_ministry: { root: "CgmExpc", items: "cgmExpc", found: ministryFound },
  annex: {
    root: "licBylSearch",
    items: "licbyl",
    found: (item: Json) => ({
      id: str(item["별표일련번호"]),
      name: clean(str(item["별표명"])),
      short: "",
      detail: joined(
        str(item["관련법령명"]),
        annexLabel(item),
        str(item["소관부처명"]),
        since(item["공포일자"], "공포"),
      ),
      current: true,
      files: annexFiles(item),
    }),
  },
  rule_annex: {
    root: "admRulBylSearch",
    items: "admrulbyl",
    found: (item: Json) => ({
      id: str(item["별표일련번호"]),
      name: clean(str(item["별표명"])),
      short: "",
      detail: joined(
        str(item["관련행정규칙명"]),
        annexLabel(item),
        str(item["소관부처명"]),
        since(item["발령일자"], "발령"),
      ),
      current: true,
      files: annexFiles(item),
    }),
  },
  ordinance_annex: {
    root: "licBylSearch",
    items: "ordinbyl",
    found: (item: Json) => ({
      id: str(item["별표일련번호"]),
      name: clean(str(item["별표명"])),
      short: "",
      detail: joined(
        str(item["관련자치법규명"]),
        annexLabel(item),
        str(item["전체기관명"]) || str(item["지자체기관명"]),
        since(item["공포일자"], "공포"),
      ),
      current: true,
      files: annexFiles(item),
    }),
  },
  treaty: {
    root: "TrtySearch",
    items: "Trty",
    found: (item: Json) => ({
      id: str(item["조약일련번호"]),
      name: clean(str(item["조약명"])),
      short: "",
      detail: joined(
        str(item["조약구분명"]),
        str(item["조약번호"]) ? `조약 제${str(item["조약번호"])}호` : "",
        since(item["발효일자"], "발효"),
      ),
      current: true,
    }),
  },
  english: {
    root: "LawSearch",
    items: "law",
    found: (item: Json) => ({
      id: str(item["법령일련번호"]),
      name: clean(str(item["법령명한글"])),
      short: "",
      detail: joined(str(item["법령명영문"]), str(item["법령구분명"]), since(item["시행일자"])),
      current: str(item["현행연혁코드"]) !== "연혁",
    }),
  },
  term: {
    root: "LsTrmSearch",
    items: "lstrm",
    found: (item: Json) => ({
      id: str(item["법령용어ID"]),
      name: clean(str(item["법령용어명"])),
      short: "",
      detail: "법령용어",
      current: true,
    }),
  },
  school: { root: "AdmRulSearch", items: "admrul", found: ruleFound },
  public_corp: { root: "AdmRulSearch", items: "admrul", found: ruleFound },
  public_institution: { root: "AdmRulSearch", items: "admrul", found: ruleFound },
} satisfies Record<Kind, { root: string; items: string; found: (item: Json) => Omit<Found, "kind"> }>

// What a search looks in: names by default; the text where asked (precedents always); an annex search can also
// look for the law, rule or ordinance the annexes belong to.
const scope = (input: { readonly kind: Kind; readonly text?: boolean; readonly law?: boolean }) => {
  if ((ANNEXES as readonly Kind[]).includes(input.kind)) return input.law ? "2" : input.text ? "3" : undefined

  return input.text || input.kind === "precedent" ? "2" : undefined
}

/**
 * Searches one kind by name, or by text where `text` is set; precedents are always searched by text. For annexes,
 * `law` makes the query the name of the law, rule or ordinance whose annexes to list. A precedent or Constitutional
 * Court decision can be found by its case number (`number`), which law.go.kr matches from its start.
 */
export const search = Effect.fn("LawApi.search")(function* (
  call: Transport,
  input: {
    readonly kind: Kind
    readonly query: string
    readonly limit: number
    readonly text?: boolean
    readonly law?: boolean
    readonly number?: string
  },
) {
  const shape = SEARCH[input.kind]
  const where = scope(input)
  const root = yield* parse(
    yield* call("lawSearch.do", {
      target: TARGETS[input.kind],
      ...(input.number ? { nb: input.number } : { query: input.query, ...(where ? { search: where } : {}) }),
      display: String(input.limit),
    }),
  )
  const answer = record(record(root)?.[shape.root])

  if (!answer) return yield* refusal(root, "법제처가 검색 결과를 주지 않았습니다. 인증키를 확인하세요.")
  const found = list(answer[shape.items]).flatMap((item) => {
    const value = record(item)

    if (!value) return []
    const { short, files, org, ...rest } = shape.found(value) as Omit<Found, "kind">

    return rest.id && rest.name
      ? [
          {
            kind: input.kind,
            ...rest,
            ...(short ? { short } : {}),
            ...(files ? { files } : {}),
            ...(org ? { org } : {}),
          } satisfies Found,
        ]
      : []
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

/** An article from its text alone, such as an ordinance's: paragraphs start with ①, items with 1. */
export const textArticle = (text: string, code?: string): ArticleText | undefined => {
  const body = clean(text)
  const heading = HEADING.exec(body)?.[0]
  const ref = heading ? LawCitation.article(/^제\s*\d+\s*조(?:\s*의\s*\d+)?/.exec(heading)?.[0] ?? "") : undefined
  const fromCode =
    code && /^\d{6}$/.test(code) ? { article: Number(code.slice(0, 4)), branch: Number(code.slice(4)) } : undefined
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

/** The labelled sections of a decision that have text, in the order given; a treaty writes empty ones as null. */
const sections = (service: Json, labels: readonly string[]) =>
  labels.flatMap((label) => {
    const text = clean(str(service[label]))

    return text && text !== "null" ? [{ label, text }] : []
  })

// An English translation's article: Article 11 (Heading) and its text, numbered as the Korean one.
const englishArticle = (unit: Json): ArticleText => {
  const text = clean(str(unit["joCts"]))
  const branch = Number(str(unit["joBrNo"])) || undefined

  return {
    article: Number(str(unit["joNo"])),
    ...(branch ? { branch } : {}),
    heading: /^Article\s+\d+(?:-\d+)?\s*(?:\([^)]*\))?/.exec(text)?.[0] ?? text.split("\n")[0]!.slice(0, 80),
    paragraphs: [],
    text,
    deleted: /^Article\s+\d+(?:-\d+)?\s*Deleted/i.test(text),
  }
}

type Read = Omit<Document, "kind" | "id">

// An administrative rule, or a school's or public body's rule, which law.go.kr serves alike.
const ruleReader = (kind: Kind) => (root: Json, id: string) => {
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
    link: link(kind, id, name),
    articles,
    // A rule written without articles, such as a 고시 of figures, is read as its text.
    sections: articles.length
      ? []
      : list(service["조문내용"]).map((value) => ({ label: "본문", text: clean(str(value)) })),
  }
}

// A special administrative appeal's decision, from the tax tribunal, a civil service appeal commission or another body.
const specialReader = (kind: Kind) => (root: Json, id: string) => {
  const service = record(root["SpecialDeccService"])

  if (!service) return undefined
  const name = clean(str(service["사건명"]))
  const field = [service["대분류"], service["중분류"]].map(str).filter(Boolean)

  return {
    name,
    detail: joined(
      str(service["재결청"]),
      str(service["청구번호"]) || str(service["사건번호"]),
      since(service["의결일자"], "의결"),
      str(service["세목"]) ? `세목 ${str(service["세목"])}` : "",
      field.join(" > "),
      str(service["원처분"]) ? `원처분 ${str(service["원처분"])}` : "",
      str(service["결정유형"]) ? `결정 ${str(service["결정유형"])}` : "",
    ),
    link: link(kind, id, name),
    articles: [],
    sections: sections(service, [
      "소청사례명",
      "처분요지",
      "소청이유",
      "주문",
      "청구취지",
      "재결요지",
      "이유",
      "관련법령",
      "관계법령",
      "참조결정",
    ]),
  }
}

// A ministry's interpretation of a law it runs, such as the customs service's or the labor ministry's.
const ministryReader = (kind: Kind) => (root: Json, id: string) => {
  const service = record(root["CgmExpcService"])

  if (!service) return undefined
  const name = clean(str(service["안건명"]))

  return {
    name,
    detail: joined(
      `${str(service["해석기관명"])} 회신 ${date(str(service["해석일자"]))}`.trim(),
      str(service["안건번호"]) ? `안건번호 ${str(service["안건번호"])}` : "",
      str(service["질의기관명"]) ? `질의 ${str(service["질의기관명"])}` : "",
      str(service["업무분야"]),
    ),
    link: link(kind, id, name),
    articles: [],
    sections: sections(service, ["질의요지", "회답", "이유", "관련법령", "관세법령정보포털원문링크"]),
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
  rule: ruleReader("rule"),
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
      sections: sections(service, ["판시사항", "판결요지", "참조조문", "참조판례", "판례내용"]),
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
      sections: sections(service, ["질의요지", "회답", "이유"]),
    }
  },
  constitutional: (root: Json, id: string) => {
    const service = record(root["DetcService"])

    if (!service) return undefined
    const name = clean(str(service["사건명"]))

    return {
      name,
      detail: joined(
        `헌법재판소 ${str(service["사건번호"])}`.trim(),
        since(service["종국일자"], "종국"),
        str(service["사건종류명"]),
      ),
      link: link("constitutional", id, name),
      articles: [],
      sections: sections(service, ["판시사항", "결정요지", "심판대상조문", "참조조문", "참조판례", "전문"]),
    }
  },
  // law.go.kr serves an administrative appeal's decision under the name it gives precedents.
  appeal: (root: Json, id: string) => {
    const service = record(root["PrecService"])

    if (!service) return undefined
    const name = clean(str(service["사건명"]))

    return {
      name,
      detail: joined(str(service["재결청"]), since(service["의결일자"], "의결"), str(service["사건번호"])),
      link: link("appeal", id, name),
      articles: [],
      sections: sections(service, ["주문", "청구취지", "재결요지", "이유"]),
    }
  },
  tax_appeal: specialReader("tax_appeal"),
  fair_trade: (root: Json, id: string) => {
    const service = record(root["FtcService"])

    if (!service) return undefined
    const name = clean(str(service["사건명"]))

    return {
      name,
      detail: joined(
        "공정거래위원회",
        squeeze(service["문서유형"]),
        clean(str(service["결정번호"])),
        since(service["결정일자"], "결정"),
        str(service["사건번호"]),
      ),
      link: link("fair_trade", id, name),
      articles: [],
      sections: sections(service, ["결정요지", "주문", "이유"]),
    }
  },
  anti_corruption: (root: Json, id: string) => {
    const outer = record(root["AcrService"])
    const service = record(outer?.["의결서"]) ?? outer

    if (!service) return undefined
    const name = clean(str(service["제목"]))

    return {
      name,
      detail: joined(
        "국민권익위원회",
        str(service["의안번호"]),
        since(service["의결일"], "의결"),
        squeeze(service["결정구분"]),
      ),
      link: link("anti_corruption", id, name),
      articles: [],
      sections: sections(service, ["결정요지", "주문", "이유", "별지"]),
    }
  },
  labor: (root: Json, id: string) => {
    const service = record(root["NlrcService"])

    if (!service) return undefined
    const name = clean(str(service["제목"]))

    return {
      name,
      detail: joined(
        str(service["담당부서"]) || "노동위원회",
        str(service["사건번호"]),
        str(service["자료구분"]),
        str(service["판정결과"]) ? `판정 ${str(service["판정결과"])}` : "",
      ),
      link: link("labor", id, name),
      articles: [],
      sections: sections(service, ["판정사항", "판정요지", "내용"]),
    }
  },
  privacy: (root: Json, id: string) => {
    const outer = record(root["PpcService"])
    const service = record(outer?.["의결서"]) ?? outer

    if (!service) return undefined
    const name = clean(str(service["안건명"]))

    return {
      name,
      detail: joined(
        "개인정보보호위원회",
        str(service["안건번호"]),
        since(str(service["의결연월일"]) || service["의결일자"], "의결"),
        squeeze(service["결정"]),
      ),
      link: link("privacy", id, name),
      articles: [],
      sections: sections(service, ["결정요지", "주문", "이유", "배경", "주요내용", "별지"]),
    }
  },
  accident_insurance: (root: Json, id: string) => {
    const service = record(root["IaciacService"])

    if (!service) return undefined
    const name = clean(str(service["사건"]))
    const field = [service["사건대분류"], service["사건중분류"], service["사건소분류"]].map(str).filter(Boolean)

    return {
      name,
      detail: joined(
        "산업재해보상보험재심사위원회",
        since(service["의결일자"], "의결"),
        str(service["원처분기관"]) ? `원처분기관 ${str(service["원처분기관"])}` : "",
        field.join(" > "),
      ),
      link: link("accident_insurance", id, name),
      articles: [],
      sections: sections(service, ["주문", "청구취지", "쟁점", "이유"]),
    }
  },
  employment_insurance: (root: Json, id: string) => {
    const service = record(root["EiacService"])

    if (!service) return undefined
    const name = clean(str(service["사건명"]))
    const notes = record(service["각주목록"])
    const numbers = list(notes?.["각주번호"]).map(str)
    const words = list(notes?.["각주내용"]).map((value) => clean(str(value)))

    return {
      name,
      detail: joined(
        str(service["기관명"]) || "고용보험심사위원회",
        str(service["사건번호"]),
        since(service["의결일자"], "의결"),
        str(service["사건의분류"]),
      ),
      link: link("employment_insurance", id, name),
      articles: [],
      sections: [
        ...sections(service, ["개요", "주문", "청구취지", "이유"]),
        ...(words.length
          ? [
              {
                label: "각주",
                text: words.map((text, index) => `[각주${numbers[index] ?? index + 1}] ${text}`).join("\n"),
              },
            ]
          : []),
      ],
    }
  },
  civil_service: specialReader("civil_service"),
  special_appeal: specialReader("special_appeal"),
  customs: ministryReader("customs"),
  labor_ministry: ministryReader("labor_ministry"),
  // Annexes are read from their files, not from this service.
  annex: () => undefined,
  rule_annex: () => undefined,
  ordinance_annex: () => undefined,
  // A treaty comes as a bilateral or multilateral service, each with the same parts.
  treaty: (root: Json, id: string) => {
    const service = record(Object.entries(root).find(([key]) => key.endsWith("TrtyService"))?.[1])
    const info = record(service?.["조약기본정보"])

    if (!service || !info) return undefined
    const name = clean(str(info["조약명_한글"]))
    const content = record(service["조약내용"])

    return {
      name,
      detail: joined(
        str(info["조약번호"]) ? `조약 제${str(info["조약번호"])}호` : "",
        since(info["서명일자"], "서명"),
        since(info["발효일자"], "발효"),
      ),
      link: link("treaty", id, name),
      articles: [],
      sections: [
        ...sections(info, ["조약명_영문", "비고"]),
        ...sections({ 조약내용: content ? content["조약내용"] : service["조약내용"] }, ["조약내용"]),
      ],
    }
  },
  english: (root: Json, id: string) => {
    const law = record(root["Law"])
    const info = record(law?.["InfSection"])

    if (!law || !info) return undefined
    const name = clean(str(info["lsNmEng"]))
    const articles = list(record(law["JoSection"])?.["Jo"]).flatMap((value) => {
      const unit = record(value)

      return unit && str(unit["joYn"]) === "Y" ? [englishArticle(unit)] : []
    })

    return {
      name,
      detail: joined("영문 번역(참고용, 효력은 한글 법령)", since(info["ancYd"], "공포")),
      link: link("english", id, name),
      articles,
      sections: [],
    }
  },
  // A term asked for by several serial numbers, one per dictionary, comes as one entry whose fields are lists.
  term: (root: Json, id: string) => {
    const entries = list(root["LsTrmService"]).flatMap((value) => {
      const entry = record(value)

      if (!entry) return []
      const count = Math.max(...Object.values(entry).map((field) => (Array.isArray(field) ? field.length : 1)))

      return Array.from({ length: count }, (_, index) =>
        Object.fromEntries(
          Object.entries(entry).map(([key, field]) => [key, Array.isArray(field) ? field[index] : field]),
        ),
      )
    })
    const first = entries[0]

    if (!first) return undefined
    const name = clean(str(first["법령용어명_한글"]))

    return {
      name,
      detail: joined("법령용어", str(first["법령용어명_한자"])),
      link: link("term", id, name),
      articles: [],
      sections: entries.flatMap((entry) =>
        sections(entry, ["법령용어정의", "용례"]).map((section) => ({
          label: `${str(entry["법령용어코드명"]) || "법령용어"} ${section.label === "용례" ? "용례" : "정의"}`,
          text: section.text,
        })),
      ),
    }
  },
  school: ruleReader("school"),
  public_corp: ruleReader("public_corp"),
  public_institution: ruleReader("public_institution"),
} satisfies Record<Kind, (root: Json, id: string) => Read | undefined>

// The parameter each kind's text is asked for by: a law by its id across versions, an English translation by its
// version, a term by its serial numbers, the others by the serial number their search gave.
const ID_PARAMETER = {
  law: "ID",
  ordinance: "MST",
  rule: "ID",
  precedent: "ID",
  interpretation: "ID",
  constitutional: "ID",
  appeal: "ID",
  tax_appeal: "ID",
  fair_trade: "ID",
  anti_corruption: "ID",
  labor: "ID",
  privacy: "ID",
  accident_insurance: "ID",
  employment_insurance: "ID",
  civil_service: "ID",
  special_appeal: "ID",
  customs: "ID",
  labor_ministry: "ID",
  annex: "ID",
  rule_annex: "ID",
  ordinance_annex: "ID",
  treaty: "ID",
  english: "MST",
  term: "trmSeqs",
  school: "ID",
  public_corp: "ID",
  public_institution: "ID",
} as const satisfies Record<Kind, string>

/**
 * A law as one of its versions had it, by the version's serial number (MST) and the date it took effect: one article
 * (the six-digit code) or the whole. law.go.kr gives a past version only for that pair.
 */
export const documentAt = Effect.fn("LawApi.documentAt")(function* (
  call: Transport,
  input: { readonly id: string; readonly mst: string; readonly effective: string; readonly article?: string },
) {
  const root = record(
    yield* parse(
      yield* call("lawService.do", {
        target: "eflaw",
        MST: input.mst,
        efYd: input.effective,
        ...(input.article ? { JO: input.article } : {}),
      }),
    ),
  )
  const read = root ? readers.law(root, input.id) : undefined

  if (!read) return yield* refusal(root, `법제처에서 ${date(input.effective)} 시행본을 찾지 못했습니다`)

  return { kind: "law", id: input.id, ...read } satisfies Document
})

/**
 * One document. A law can be asked for one article (`article`, the six-digit code), which keeps a long law's answer
 * small; the others always come whole. A law is read as the version in force today: asked under its own target,
 * law.go.kr gives the latest promulgated version even before it takes effect. A law with no version in force yet is
 * read as promulgated, its 시행일 still to come.
 */
export const document = Effect.fn("LawApi.document")(function* (
  call: Transport,
  input: { readonly kind: Kind; readonly id: string; readonly article?: string },
) {
  const ask = (target: string) =>
    call("lawService.do", {
      target,
      [ID_PARAMETER[input.kind]]: input.id,
      ...(input.kind === "law" && input.article ? { JO: input.article } : {}),
    }).pipe(
      Effect.flatMap(parse),
      Effect.map((root) => {
        const answer = record(root)

        return { answer, read: answer ? readers[input.kind](answer, input.id) : undefined }
      }),
    )
  const inForce = input.kind === "law" ? yield* ask("eflaw").pipe(Effect.orElseSucceed(() => undefined)) : undefined
  const { answer, read } = inForce?.read ? inForce : yield* ask(TARGETS[input.kind])

  if (!read) return yield* refusal(answer, `법제처에서 ${input.id}의 본문을 찾지 못했습니다`)

  return { kind: input.kind, id: input.id, ...read } satisfies Document
})
