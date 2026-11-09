export * as LawTools from "./tools.js"

import { ToolFailure } from "@opencode/ai"
import { DocumentText } from "@opencode/util/document-text"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { Mime } from "../../../mime.js"
import type { Tool } from "../../../tool.js"
import { ReadDocument } from "../../../tool/read-document.js"
import { LawAmendment } from "./amendment.js"
import { AmendmentHwpx } from "./amendment-hwpx.js"
import { LawApi } from "./api.js"
import { LawCases } from "./cases.js"
import { LawCitation } from "./citation.js"
import { LawCompare } from "./compare.js"
import { LawRegion } from "./region.js"
import { LawSettings } from "./settings.js"
import { WorkProfile } from "../work/profile.js"

// The law tools every 자비수 session has: search the official law database, read articles in their official words,
// trace a law's amendments and the rules under it, draft the comparison table of an amendment, and check that the
// articles and cases an answer cites exist. Answers about what a law says rest on these, not on what the model
// remembers.

/** Saves a file the user asked for in the session's folder, with the same approval as any edit; gives where it went. */
export type Save = (
  file: string,
  bytes: Uint8Array,
  context: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">,
) => Effect.Effect<string, ToolFailure>

export interface Dependencies {
  readonly fs: FSUtil.Interface
  /** The 업무 프로필 under home names the user's 지자체, whose ordinances a search looks in first. */
  readonly global: Pick<Global.Interface, "config" | "home">
  readonly http: HttpClient.HttpClient
  readonly save?: Save
}

const KIND = Schema.Literals(LawApi.KINDS)

const KIND_NAMES = {
  law: "법령",
  ordinance: "자치법규",
  rule: "행정규칙",
  precedent: "판례",
  interpretation: "법령해석례",
  constitutional: "헌재결정례",
  appeal: "행정심판례",
  tax_appeal: "조세심판원 재결례",
  fair_trade: "공정거래위원회 결정문",
  anti_corruption: "국민권익위원회 결정문",
  labor: "노동위원회 결정문",
  privacy: "개인정보보호위원회 결정문",
  accident_insurance: "산업재해보상보험재심사위원회 재결",
  employment_insurance: "고용보험심사위원회 재결",
  civil_service: "소청심사위원회 결정",
  special_appeal: "특별행정심판 재결",
  customs: "관세청 법령해석",
  labor_ministry: "고용노동부 법령해석",
  annex: "법령 별표·서식",
  rule_annex: "행정규칙 별표·서식",
  ordinance_annex: "자치법규 별표·서식",
  treaty: "조약",
  english: "영문법령",
  term: "법령용어",
  school: "학칙",
  public_corp: "지방공사·공단 규정",
  public_institution: "공공기관 규정",
} satisfies Record<LawApi.Kind, string>

// Without the user's key, the model must not reach the same data another way, such as law.go.kr's API with a
// sample key or by scraping its pages: that is the user's key to give.
const NOT_SET = [
  "법령 찾기 is not set up: there is no 법제처 Open API key.",
  "Tell the user to get a free key at https://open.law.go.kr (회원가입 → OPEN API 신청) and enter it in 설정 → 환경 설정 → 법령 찾기.",
  "Do not work around it: do not call law.go.kr's API with any other key and do not scrape law.go.kr pages.",
  "Answer from what you know, mark every statement of what a law says (확인 필요), and give the law's page https://www.law.go.kr/법령/<name without spaces> for the user to check.",
].join(" ")

// One answer's worth of law text; a precedent's full judgment can run to tens of thousands of characters.
const MAX_CHARS = 30_000
const MAX_SECTION_CHARS = 6_000
const MAX_HEADINGS = 400
const MAX_CITATIONS = 30
const MAX_CASES = 10

// Dates in law.go.kr are Korean dates; a version taking effect today is in force from midnight in Korea.
const KST = 9 * 3_600_000

const HOUR = 3_600_000
const MAX_CACHED = 200

export const SearchInput = Schema.Struct({
  query: Schema.String.annotate({
    description: "Words to search for, such as a law's name (보조금 관리에 관한 법률) or a topic (바이오 육성)",
  }),
  kind: Schema.optional(KIND).annotate({
    description: [
      "law: laws and decrees (default); ordinance: local ordinances (조례·규칙); rule: administrative rules (고시·훈령·예규·지침);",
      "precedent: court precedents; interpretation: 법제처 interpretations; constitutional: 헌법재판소 decisions;",
      "appeal: administrative appeals (행정심판); tax_appeal: 조세심판원; fair_trade: 공정거래위원회; anti_corruption: 국민권익위원회;",
      "labor: 노동위원회; privacy: 개인정보보호위원회; accident_insurance: 산재보험재심사위원회; employment_insurance: 고용보험심사위원회;",
      "civil_service: 인사혁신처 소청심사위원회; special_appeal: other special appeals (지방소청심사위원회, 건강보험분쟁조정위원회 …);",
      "customs, labor_ministry: interpretations of 관세청, 고용노동부; annex: annexes and forms (별표·서식) of laws, searched by their title;",
      "rule_annex, ordinance_annex: those of rules and ordinances; treaty: treaties; english: English translations; term: legal terms;",
      "school: 학칙; public_corp: rules of local public corporations (지방공사·공단); public_institution: rules of public institutions (공공기관)",
    ].join(" "),
  }),
  text: Schema.optional(Schema.Boolean).annotate({
    description: "Search the text instead of names (precedents are always searched by text)",
  }),
  law: Schema.optional(Schema.String).annotate({
    description:
      "Annex kinds only: the law, rule or ordinance whose annexes and forms to list, such as 식품위생법 시행규칙; query then keeps those whose title has its words",
  }),
  region: Schema.optional(Schema.String).annotate({
    description:
      "Ordinances only: the 지자체 whose ordinances to search, such as 세종특별자치시, 경기도 수원시 or 대구광역시 중구. Left out, an ordinance search looks in the user's own 지자체 (the 소속 in their 업무 프로필) first; 전국 searches every 지자체. A text search always covers every 지자체",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))).annotate({
    description: "Maximum results (default: 10)",
  }),
})

const FoundOutput = Schema.Struct({
  kind: KIND,
  id: Schema.String,
  name: Schema.String,
  detail: Schema.String,
  current: Schema.Boolean,
})

export const SearchOutput = Schema.Struct({
  configured: Schema.Boolean,
  total: Schema.Number,
  found: Schema.Array(FoundOutput),
  /** The 지자체 an ordinance search kept to. */
  region: Schema.optional(Schema.String),
})

export const TextInput = Schema.Struct({
  kind: Schema.optional(KIND).annotate({ description: "What it is, as law_search names it (default: law)" }),
  id: Schema.optional(Schema.String).annotate({ description: "The id law_search gave" }),
  name: Schema.optional(Schema.String).annotate({
    description: "The exact name of a law, ordinance or rule, when there is no id",
  }),
  articles: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(10))).annotate({
    description: 'Articles to read, such as ["제11조", "제26조의2"]; leave out for the list of articles',
  }),
})

export const TextOutput = Schema.Struct({
  configured: Schema.Boolean,
  name: Schema.optional(Schema.String),
  link: Schema.optional(Schema.String),
  missing: Schema.Array(Schema.String),
})

const MODES = ["changes", "delegation", "system", "history", "as_of", "ordinance"] as const

export const CompareInput = Schema.Struct({
  mode: Schema.Literals(MODES).annotate({
    description: [
      "changes: what the law's latest amendment changed, article by article (신구법 비교);",
      "delegation: the decree (시행령) and rule (시행규칙) articles that carry out each article of a law (3단 비교);",
      "system: the decrees, rules and administrative rules made under the law, and the law above a decree or rule (법령 체계도);",
      "history: every amendment with the dates it was promulgated and took effect (연혁);",
      "as_of: the law as in force on a date, such as the day of an act or a decision (행위시법);",
      "ordinance: which of the laws a local ordinance carries out were amended after it took effect (조례 정비 점검)",
    ].join(" "),
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "The id law_search gave: of a law (kind law), or of an ordinance for mode ordinance",
  }),
  name: Schema.optional(Schema.String).annotate({ description: "The exact name, when there is no id" }),
  articles: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(10))).annotate({
    description:
      'delegation, as_of: the articles to read, such as ["제4조"]; leave out for the list of articles (delegation: with their decree and rule articles\' headings)',
  }),
  date: Schema.optional(Schema.String).annotate({ description: "as_of: the date, such as 2024-01-01" }),
})

export const CompareOutput = Schema.Struct({
  configured: Schema.Boolean,
  name: Schema.optional(Schema.String),
  missing: Schema.Array(Schema.String),
})

export const AmendInput = Schema.Struct({
  kind: Schema.optional(Schema.Literals(LawApi.STATUTES)).annotate({
    description: "What is amended: law (default), ordinance or rule",
  }),
  id: Schema.optional(Schema.String).annotate({ description: "Its id from law_search" }),
  name: Schema.optional(Schema.String).annotate({ description: "Its exact name, when there is no id" }),
  title: Schema.optional(Schema.String).annotate({
    description: "The draft's name, such as 건축법 일부개정법률안; made from the name when left out",
  }),
  amendments: Schema.Array(
    Schema.Struct({
      text: Schema.String.annotate({
        description:
          "One article as amended, whole: 제N조(제목) and then one paragraph or item to a line. Unchanged ones may be written as ② ∼ ⑤ (현행과 같음) or 1.·2. (현행과 같음); a current one left out counts as deleted. ③ 삭제 deletes a paragraph, 제5조 삭제 the article, and a new number adds one",
      }),
      current: Schema.optional(Schema.String).annotate({
        description:
          "The current article's text, only when law.go.kr cannot give it, as for a draft not yet promulgated; empty for a new article",
      }),
    }),
  )
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(30)),
  file: Schema.optional(Schema.String).annotate({
    description: "A file name to also save it as a Hangul document in this folder, such as 신구조문대비표.hwpx",
  }),
})

export const AmendOutput = Schema.Struct({
  configured: Schema.Boolean,
  title: Schema.String,
  file: Schema.optional(Schema.String),
  notes: Schema.Array(Schema.String),
})

export const VerifyInput = Schema.Struct({
  text: Schema.String.annotate({
    description:
      "The answer or document text whose citations to check: laws with names in 「」, and cases by number such as 2013다61381",
  }),
})

const RESULTS = ["ok", "missing", "deleted", "unknown", "changed"] as const

export const VerifyOutput = Schema.Struct({
  configured: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({ citation: Schema.String, result: Schema.Literals(RESULTS), note: Schema.String }),
  ),
})

export type Check = { readonly citation: string; readonly result: (typeof RESULTS)[number]; readonly note: string }

const failure = (error: LawApi.LawError) => new ToolFailure({ message: error.reason })

// law.go.kr gives at most 100 results a call; a 지자체's ordinances on a topic fit in that.
const REGION_SCAN = 100

/** What the model is told about the 지자체 an ordinance search kept to. */
export function regionNote(region: LawRegion.Region, own: boolean, partial: boolean) {
  return [
    own
      ? `Kept to ${region.name}, the user's 지자체 (the 소속 in their 업무 프로필). For another 지자체 give region; for every 지자체 give region 전국.`
      : `Kept to ${region.name}.`,
    ...(region.province
      ? [
          `${region.province}'s own ordinances may apply too: search again with region ${region.province} when they might.`,
        ]
      : []),
    ...(partial ? ["Only law.go.kr's first 100 results were looked through: add words to narrow the search."] : []),
  ].join(" ")
}

/** The search results as the model reads them. */
export function searchContent(kind: LawApi.Kind, total: number, found: readonly LawApi.Found[]) {
  if (found.length === 0) return `No ${KIND_NAMES[kind]} found. Try other or fewer words, or another kind.`

  return [
    `${KIND_NAMES[kind]} ${found.length} of ${total}:`,
    ...found.map(
      (item) =>
        `- ${item.name}${item.short ? ` (약칭 ${item.short})` : ""} · id ${item.id} · ${item.detail}${item.current ? "" : " · 연혁(현행 아님)"}`,
    ),
    "",
    "Read it with law_text before relying on it.",
  ].join("\n")
}

const cut = (text: string, limit: number, link: string) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n… (이하 생략, 전체 ${text.length}자: ${link})`

/** An annex or form as the model reads it: what it is, where its files are, and its text when it has any. */
export function annexContent(found: LawApi.Found, text: string | undefined) {
  const files = found.files ?? {}

  return cut(
    [
      `「${found.name}」 (${found.detail})`,
      ...(files.hwp ? [`한글 파일: ${LawApi.link(found.kind, found.id, found.name, { hwp: files.hwp })}`] : []),
      ...(files.pdf ? [`PDF: ${LawApi.link(found.kind, found.id, found.name, { pdf: files.pdf })}`] : []),
      "",
      text ?? "(이 파일에는 읽을 글자가 없습니다: 그림이나 스캔으로 된 서식입니다. 파일을 열어 확인하세요.)",
      "",
      "This is the annex as law.go.kr keeps it. To fill in a form, give the user the file links above.",
    ].join("\n"),
    MAX_CHARS,
    LawApi.link(found.kind, found.id, found.name, files),
  )
}

/** A document as the model reads it: what it is, then the articles asked for or its sections. */
export function documentContent(
  document: LawApi.Document,
  articles: readonly LawApi.ArticleText[] | "headings",
  missing: readonly string[],
) {
  const body =
    articles === "headings"
      ? document.articles.length
        ? [
            "Articles (ask law_text for the ones you need):",
            ...document.articles.slice(0, MAX_HEADINGS).map((item) => item.heading),
            ...(document.articles.length > MAX_HEADINGS ? [`… ${document.articles.length - MAX_HEADINGS} more`] : []),
          ]
        : document.sections.map(
            (section) => `[${section.label}]\n${cut(section.text, MAX_SECTION_CHARS, document.link)}`,
          )
      : articles.map((item) => `${item.text}${item.effective ? `\n[시행 ${item.effective}]` : ""}`)

  return cut(
    [
      `「${document.name}」 (${document.detail}) ${document.link}`,
      "",
      ...body,
      ...(missing.length ? ["", `Not in this text: ${missing.join(", ")}`] : []),
      "",
      (LawApi.STATUTES as readonly string[]).includes(document.kind)
        ? "Quote only these words, with the 시행일, and cite as 「name」 제N조 제M항."
        : "Quote only these words, and name where they come from as above.",
    ].join("\n"),
    MAX_CHARS,
    document.link,
  )
}

// A decree or rule article shown beside the law's runs long when it lists its own items; this keeps ten of them in one
// answer.
const MAX_LINKED_CHARS = 2_000

/** A latest amendment's changes as the model reads them. */
export function changesContent(changes: LawCompare.Changes) {
  const body = changes.pairs.length
    ? changes.pairs.flatMap((pair, index) => [
        ...(pair.article !== changes.pairs[index - 1]?.article ? [`[${pair.article || "조문 앞"}]`] : []),
        `개정 전: ${pair.before || "(없음)"}`,
        `개정 후: ${pair.after || "(없음)"}`,
        "",
      ])
    : ["(바뀐 줄이 없습니다)", ""]

  return cut(
    [
      `「${changes.name}」 신구법 비교`,
      `개정 전: ${changes.before}`,
      `개정 후: ${changes.after}`,
      "",
      ...body,
      "These are the two latest promulgated versions as law.go.kr compares them; check each 시행일, as a version can be promulgated before it is in force. Read the articles with law_text before quoting them.",
    ].join("\n"),
    MAX_CHARS,
    `https://www.law.go.kr/법령/${LawCitation.key(changes.name)}`,
  )
}

/** A 3단 비교 as the model reads it: headings for every linked article, or the articles asked for in full. */
export function delegationContent(
  delegation: LawCompare.Delegation,
  refs: readonly LawCitation.Article[],
  missing: readonly string[],
) {
  const linkedLine = (item: LawCompare.Delegation["articles"][number]) =>
    `${item.heading} → ${item.linked.map((linked) => `${linked.level} ${linked.heading}`).join(" · ")}`
  const body = refs.length
    ? delegation.articles
        .filter((item) => refs.some((ref) => LawCompare.isArticle(item, ref)))
        .flatMap((item) => [
          `${item.heading} ${item.text}`,
          ...(item.linked.length
            ? item.linked.map(
                (linked) =>
                  `  [${linked.level}] ${linked.heading} ${cut(linked.text, MAX_LINKED_CHARS, linked.heading)}`,
              )
            : ["  (이 조문을 따르는 시행령·시행규칙 조문이 없습니다)"]),
          "",
        ])
    : [
        "Articles with decree or rule articles that carry them out (ask with articles for their text):",
        ...delegation.articles.filter((item) => item.linked.length).map(linkedLine),
        "",
        `${delegation.articles.filter((item) => !item.linked.length).length} other articles have none.`,
      ]

  return cut(
    [
      `「${delegation.name}」 3단 비교`,
      ...(delegation.decree ? [`시행령: ${delegation.decree}`] : []),
      ...(delegation.rule ? [`시행규칙: ${delegation.rule}`] : []),
      "",
      ...body,
      ...(missing.length ? ["", `Not in this law: ${missing.join(", ")}`] : []),
    ].join("\n"),
    MAX_CHARS,
    `https://www.law.go.kr/법령/${LawCitation.key(delegation.name)}`,
  )
}

/** A law's 체계도 as the model reads it: each law and rule with where it sits and the id to read it by. */
export function systemContent(system: LawCompare.System) {
  return cut(
    [
      `「${system.name}」 법령 체계도 (${system.detail})`,
      "",
      ...(system.below.length
        ? system.below.map((item) => `- ${item.path}: ${item.name} (${item.detail}) · ${item.kind} id ${item.id}`)
        : ["(이 법령 아래나 위에 다른 법령·행정규칙이 없습니다)"]),
      "",
      "Read any of them with law_text, giving its kind and id.",
    ].join("\n"),
    MAX_CHARS,
    `https://www.law.go.kr/법령/${LawCitation.key(system.name)}`,
  )
}

// A law's history as one answer: the newest versions, which is what a question about it nearly always needs.
const MAX_VERSIONS = 60

const versionLine = (row: LawCompare.Version) =>
  [
    `시행 ${LawApi.date(row.effective)}`,
    row.status && row.status !== "연혁" ? `(${row.status})` : "",
    `· ${row.kind} 제${row.number}호 · 공포 ${LawApi.date(row.promulgated)} · ${row.change}`,
  ]
    .filter(Boolean)
    .join(" ")

/** A law's versions as the model reads them, newest first. */
export function historyContent(rows: readonly LawCompare.Version[]) {
  const name = rows[0]?.name ?? ""
  // Old versions often write the same name without spaces; only another name is a rename.
  const other = (item: string) => LawCitation.key(item) !== LawCitation.key(name)
  const renamed = [...new Set(rows.map((row) => row.name))].filter(other)

  return [
    `「${name}」 연혁 (${rows.length}개 시행본, 새것부터)`,
    ...(renamed.length ? [`예전 이름: ${renamed.join(", ")}`] : []),
    "",
    ...rows.slice(0, MAX_VERSIONS).map((row) => `- ${versionLine(row)}${other(row.name) ? ` · ${row.name}` : ""}`),
    ...(rows.length > MAX_VERSIONS ? [`… 그 전 ${rows.length - MAX_VERSIONS}개`] : []),
    "",
    "An amendment taking effect in stages is listed once per stage. Read the law as it stood on a date with mode as_of.",
  ].join("\n")
}

/** An ordinance's check against the laws it carries out, as the model reads it. */
export function ordinanceContent(
  ordinance: LawCompare.Ordinance,
  laws: readonly {
    readonly name: string
    readonly found?: { readonly id: string; readonly name: string }
    readonly rows?: readonly LawCompare.Version[]
    readonly error?: string
  }[],
  today: string,
) {
  const lines = laws.flatMap((law) => {
    if (!law.found)
      return [
        `- 「${law.name}」: ${law.error ?? "법령에서 찾지 못했습니다 (이름이 바뀌었거나 폐지되었을 수 있습니다)"}`,
      ]
    const rows = law.rows ?? []
    const after = rows.filter((row) => row.effective > ordinance.effective)
    const inForce = LawCompare.inForce(rows, today)
    const head = `- 「${law.found.name}」 (id ${law.found.id})`

    if (!after.length)
      return [
        `${head}: 조례 시행 뒤 시행된 개정 없음${inForce ? ` (현행 시행 ${LawApi.date(inForce.effective)})` : ""}`,
      ]

    return [
      `${head}: 조례 시행 뒤 시행된 개정 ${after.filter((row) => row.effective <= today).length}건, 시행 예정 ${after.filter((row) => row.effective > today).length}건`,
      // One promulgated before the ordinance took effect may already be carried out in it.
      ...after.map(
        (row) =>
          `  · ${versionLine(row)}${row.effective > today ? " (시행 예정)" : ""}${row.promulgated <= ordinance.effective ? " (조례 시행 전 공포)" : ""}`,
      ),
    ]
  })

  return cut(
    [
      `「${ordinance.name}」 정비 점검 (${ordinance.detail})`,
      `목적 조문: ${ordinance.purpose || "(없음)"}`,
      "",
      ...(laws.length
        ? [
            `목적 조문이 근거로 든 법령 ${laws.length}개와 조례 시행일(${LawApi.date(ordinance.effective)}) 뒤의 개정:`,
            ...lines,
          ]
        : ["목적 조문에서 근거 법령을 찾지 못했습니다. 조례 본문을 law_text로 읽고 근거 법령을 확인하세요."]),
      "",
      "An amendment after the ordinance took effect is only a sign to check, not proof that the ordinance must change: a 타법개정 often leaves what it carries out alone. Read what changed with law_compare (changes, delegation, as_of) before saying it needs amending.",
    ].join("\n"),
    MAX_CHARS,
    `https://www.law.go.kr/자치법규/${LawCitation.key(ordinance.name)}`,
  )
}

/** An amendment's table as the model reads it. */
export function amendContent(
  title: string,
  articles: readonly (readonly LawAmendment.Row[])[],
  notes: readonly string[],
  saved?: string,
) {
  return cut(
    [
      articles.length
        ? LawAmendment.markdown(`${title} 신·구조문대비표`, articles)
        : "입력한 개정안이 모두 현행과 같아 대비표에 적을 것이 없습니다.",
      "",
      ...(articles.length
        ? [
            "Bold marks the underlined words (바뀐 부분); dashes mark the amendment's words that stay as they are. A word put in or taken out is underlined with the word before it on both sides, as official tables do. Copy the table into your answer exactly as it is; do not retype it.",
          ]
        : []),
      ...(notes.length ? ["", "확인할 점:", ...notes.map((note) => `- ${note}`)] : []),
      ...(saved ? ["", `한글 파일로 저장했습니다: ${saved}`] : []),
    ].join("\n"),
    MAX_CHARS,
    "https://www.law.go.kr",
  )
}

/** The citation checks as the model reads them. */
export function checksContent(checks: readonly Check[]) {
  if (checks.length === 0)
    return "No citations found. Write each as 「법령명」 제N조 (제M항 제K호), and a case by its number such as 대법원 2013다61381."
  const marks = { ok: "✓", missing: "✗", deleted: "✗", unknown: "?", changed: "⚠" } as const

  return [
    ...checks.map((check) => `${marks[check.result]} ${check.citation} — ${check.note}`),
    "",
    checks.every((check) => check.result === "ok")
      ? "Every citation exists in the current official text."
      : "Fix each ✗, ? and ⚠ before giving the answer, or mark it (확인 필요); read the article or case with law_text.",
  ].join("\n")
}

/** The article a reference points to among a document's articles. */
const articleOf = (articles: readonly LawApi.ArticleText[], ref: LawCitation.Article) =>
  articles.find((item) => item.article === ref.article && (item.branch ?? 0) === (ref.branch ?? 0))

/** Whether the paragraph and item a reference names are in the article; a reason when not. */
export function locate(article: LawApi.ArticleText, ref: LawCitation.Article) {
  const numbered = article.paragraphs.filter((item) => item.number > 0)
  const paragraph = ref.paragraph ? numbered.find((item) => item.number === ref.paragraph) : undefined

  if (ref.paragraph && !paragraph)
    return numbered.length
      ? `${LawCitation.label({ ...ref, paragraph: undefined, item: undefined })}에 제${ref.paragraph}항이 없습니다 (제1항~제${numbered.length}항)`
      : `${LawCitation.label({ ...ref, paragraph: undefined, item: undefined })}은 항으로 나뉘어 있지 않습니다`
  if (ref.item) {
    const items = (paragraph ? [paragraph] : article.paragraphs).flatMap((item) => item.items)

    if (!items.some((item) => item.number === ref.item))
      return `${LawCitation.label({ ...ref, item: undefined })}에 제${ref.item}호가 없습니다`
  }

  return undefined
}

// A paragraph or item an amendment deleted keeps its number with only 삭제 left: ⑥ 삭제 <2026.2.27>.
const DELETED_UNIT = /^\s*(?:[①-⑳]|\d+(?:의\d+)?\.)?\s*삭제\s*$/

/** Whether the paragraph or item a reference names is there only as deleted. */
export function removed(article: LawApi.ArticleText, ref: LawCitation.Article) {
  const paragraph = ref.paragraph ? article.paragraphs.find((item) => item.number === ref.paragraph) : undefined

  if (!ref.item) return paragraph !== undefined && DELETED_UNIT.test(paragraph.text)
  const item = (paragraph ? [paragraph] : article.paragraphs)
    .flatMap((entry) => entry.items)
    .find((entry) => entry.number === ref.item)

  return item !== undefined && DELETED_UNIT.test(item.text.split("\n")[0]!)
}

/** The tools, sharing one cache of what law.go.kr answered. */
export function tools(deps: Dependencies) {
  const cache = new Map<string, { at: number; value: unknown }>()
  const remember = <A>(key: string, ttl: number, effect: Effect.Effect<A, LawApi.LawError>) =>
    Effect.suspend(() => {
      const hit = cache.get(key)

      if (hit && Date.now() - hit.at < ttl) return Effect.succeed(hit.value as A)

      return effect.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            cache.set(key, { at: Date.now(), value })
            for (const old of [...cache.keys()].slice(0, Math.max(0, cache.size - MAX_CACHED))) cache.delete(old)
          }),
        ),
      )
    })

  // The key is read on every call, so a key entered in the settings works at once.
  const transport = Effect.gen(function* () {
    const key = yield* LawSettings.key(deps)

    return key === undefined ? undefined : LawApi.transport(deps.http, key)
  })

  // The user's 지자체, read on every search so an edited 업무 프로필 applies at once.
  const ownRegion = deps.fs.readFileStringSafe(WorkProfile.file(deps.global)).pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.map((text) => (text === undefined ? undefined : LawRegion.fromProfile(text))),
  )

  // An annex is read from the files its search result names, so each annex found is kept by its id.
  const annexes = new Map<string, LawApi.Found>()
  const download = LawApi.download(deps.http)

  const search = (call: LawApi.Transport, input: Parameters<typeof LawApi.search>[1]) =>
    remember(`search\0${JSON.stringify(input)}`, HOUR, LawApi.search(call, input)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          for (const found of result.found) {
            if (!found.files) continue
            annexes.delete(`${found.kind}\0${found.id}`)
            annexes.set(`${found.kind}\0${found.id}`, found)
          }
          for (const old of [...annexes.keys()].slice(0, Math.max(0, annexes.size - MAX_CACHED))) annexes.delete(old)
        }),
      ),
    )

  // The annex's text from its Hangul file, or from its PDF when the Hangul file has none; none when it is pictures.
  // The format comes from the file itself: the Hangul file can be HWP or HWPX, and law.go.kr can send a page of words
  // in place of a file.
  const annexText = (found: LawApi.Found) =>
    remember(
      `annex\0${found.kind}\0${found.id}`,
      24 * HOUR,
      Effect.gen(function* () {
        for (const path of [found.files?.hwp, found.files?.pdf]) {
          if (!path) continue
          const bytes = yield* download(path)
          const format: ReadDocument.Format | undefined =
            Mime.detect(bytes) === "application/pdf"
              ? "pdf"
              : yield* Effect.promise(() => DocumentText.sniff(bytes).catch(() => undefined))

          if (!format) continue
          const text = yield* Effect.tryPromise(() => ReadDocument.text(format, bytes)).pipe(
            Effect.orElseSucceed(() => ""),
          )

          if (text.trim()) return text.trim()
        }

        return undefined
      }),
    )

  // A law is read one article at a time; ordinances and rules are short and come whole.
  const read = (call: LawApi.Transport, kind: LawApi.Kind, id: string, article?: string) =>
    remember(`text\0${kind}\0${id}\0${article ?? ""}`, 24 * HOUR, LawApi.document(call, { kind, id, article }))

  // The law, ordinance or rule a name means: the one whose name or short name is the same, kinds tried in the order
  // the name suggests.
  const resolve = Effect.fn("LawTools.resolve")(function* (
    call: LawApi.Transport,
    name: string,
    kinds: readonly LawApi.Kind[],
  ) {
    const others: string[] = []

    for (const kind of kinds) {
      const { found } = yield* search(call, { kind, query: name, limit: 20 })
      const same = found.find(
        (item) =>
          LawCitation.key(item.name) === LawCitation.key(name) ||
          (item.short !== undefined && LawCitation.key(item.short) === LawCitation.key(name)),
      )

      if (same) return { found: same, others }
      others.push(...found.slice(0, 3).map((item) => item.name))
    }

    return { found: undefined, others }
  })

  const kindsFor = (name: string): readonly LawApi.Kind[] => {
    if (/(조례|조례 시행규칙)$/.test(name) || /^\S+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)\s/.test(name))
      return ["ordinance", "law", "rule"]
    if (/(고시|훈령|예규|지침|규정|요령|기준|지시)$/.test(name)) return ["rule", "law", "ordinance"]

    return ["law", "rule", "ordinance"]
  }

  const readArticles = Effect.fn("LawTools.articles")(function* (
    call: LawApi.Transport,
    found: Pick<LawApi.Found, "kind" | "id">,
    refs: readonly LawCitation.Article[],
  ) {
    if (found.kind !== "law") {
      const document = yield* read(call, found.kind, found.id)

      return { document, articles: refs.map((ref) => articleOf(document.articles, ref)) }
    }
    const documents = yield* Effect.forEach(refs, (ref) => read(call, "law", found.id, LawCitation.code(ref)), {
      concurrency: 4,
    })

    return {
      document: documents[0]!,
      articles: refs.map((ref, index) => articleOf(documents[index]!.articles, ref)),
    }
  })

  // law.go.kr names an ordinance after its 지자체, so the 지자체's word finds its ordinances by name; the results are
  // kept to that 기관, since one word can name several 지자체 (중구, 고성군).
  const within = (
    call: LawApi.Transport,
    region: LawRegion.Region,
    input: { readonly kind: LawApi.Kind; readonly query: string; readonly limit: number },
  ) =>
    search(call, { kind: input.kind, query: LawRegion.query(region, input.query), limit: REGION_SCAN }).pipe(
      Effect.map(({ total, found }) => {
        const kept = found.filter((item) => LawRegion.matches(region, item.org))

        return { total: kept.length, found: kept.slice(0, input.limit), partial: total > found.length }
      }),
      Effect.mapError(failure),
    )

  const searchTool = {
    name: "law_search",
    options: { codemode: false },
    description:
      "Search Korea's official law database (국가법령정보센터, law.go.kr of 법제처): laws and decrees, local ordinances (자치법규), administrative rules (고시·훈령·예규), court precedents, 법제처 interpretations, decisions of the Constitutional Court, administrative appeals and committees, annexes and forms (별표·서식), treaties, English translations and legal terms. Use it whenever an answer depends on what a law, ordinance or rule says, and do not quote laws from memory. Then read what it found with law_text.",
    input: SearchInput,
    output: SearchOutput,
    execute: (input: typeof SearchInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call)
          return { output: { configured: false, total: 0, found: [] }, content: NOT_SET } satisfies {
            output: typeof SearchOutput.Type
            content: string
          }
        const kind = input.kind ?? "law"
        const limit = input.limit ?? 10
        const annex = (LawApi.ANNEXES as readonly string[]).includes(kind)

        if (input.law && !annex)
          return yield* new ToolFailure({
            message: "law lists annexes: use it with kind annex, rule_annex or ordinance_annex.",
          })
        if (input.region !== undefined && kind !== "ordinance")
          return yield* new ToolFailure({
            message: "region keeps an ordinance search to one 지자체: use it with kind ordinance.",
          })
        // An ordinance search by name keeps to one 지자체: the one named, else the user's own. law.go.kr gives a text
        // search's results in 가나다 order, so the first 100 rarely reach that 지자체; a text search covers them all.
        const named = input.region?.trim() || undefined
        const everywhere = named !== undefined && LawRegion.EVERYWHERE.includes(named)
        const textual = input.text === true
        const region =
          kind !== "ordinance" || everywhere || textual ? undefined : named ? LawRegion.parse(named) : yield* ownRegion

        if (named && !everywhere && !textual && !region)
          return yield* new ToolFailure({
            message: `「${named}」 is not a 지자체 name: give one such as 세종특별자치시, 경기도 수원시 or 대구광역시 중구, or 전국.`,
          })
        // A case asked for by its number is found by it; its text would only find the cases that cite it.
        const number = kind === "precedent" || kind === "constitutional" ? LawCases.find(input.query)[0] : undefined
        const local = region ? yield* within(call, region, { kind, query: input.query, limit }) : undefined
        // The user's own 지자체 may have nothing on it; then every 지자체's ordinances are searched.
        const kept = local && (local.found.length > 0 || named) ? local : undefined
        const result = kept
          ? kept
          : input.law
            ? yield* search(call, { kind, query: input.law, limit: 100, law: true }).pipe(
                Effect.map(({ found }) => {
                  // The annexes of that law whose title has every word of the query, unless the query is the law again.
                  const words =
                    LawCitation.key(input.query) === LawCitation.key(input.law ?? "") ? [] : input.query.split(/\s+/)
                  const kept = found.filter((item) => words.every((word) => item.name.includes(word)))

                  return { total: kept.length, found: kept.slice(0, limit) }
                }),
                Effect.mapError(failure),
              )
            : yield* search(call, {
                kind,
                query: input.query,
                limit,
                ...(input.text ? { text: true } : {}),
                ...(number ? { number } : {}),
              }).pipe(Effect.mapError(failure))

        const note =
          kind === "ordinance" && textual && named && !everywhere
            ? `A text search covers every 지자체, not only ${named}: to keep to it, search the names (without text).`
            : !region
              ? undefined
              : kept
                ? regionNote(region, named === undefined, kept.partial)
                : `${region.name} has no ordinance on this, so these are from every 지자체.`

        return {
          output: {
            configured: true,
            total: result.total,
            found: result.found.map(({ short: _short, files: _files, org: _org, ...item }) => item),
            ...(kept && region ? { region: region.name } : {}),
          },
          content: [...(note ? [note] : []), searchContent(kind, result.total, result.found)].join("\n"),
        }
      }),
  }

  const textTool = {
    name: "law_text",
    options: { codemode: false },
    description:
      "Read the official text of a law, ordinance or rule: the articles asked for, such as 제11조 or 제26조의2, or its list of articles when none are given; or anything else law_search found: a precedent, interpretation or decision, an annex or form (with links to its Hangul and PDF files), a treaty, an English translation, a legal term, or a school's or public body's rule. Quote only these words, with the 시행일.",
    input: TextInput,
    output: TextOutput,
    execute: (input: typeof TextInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call) return { output: { configured: false, missing: [] }, content: NOT_SET }
        const kind = input.kind ?? "law"

        if ((LawApi.ANNEXES as readonly string[]).includes(kind)) {
          const found = input.id === undefined ? undefined : annexes.get(`${kind}\0${input.id}`)

          if (!found)
            return yield* new ToolFailure({
              message: `Find the ${kind} with law_search first and give the id it found: an annex is read from the files its search result names.`,
            })
          const text = yield* annexText(found).pipe(Effect.mapError(failure))
          const link = LawApi.link(found.kind, found.id, found.name, found.files)

          return {
            output: { configured: true, name: found.name, link, missing: [] },
            content: annexContent(found, text),
          }
        }
        const statute = (LawApi.STATUTES as readonly string[]).includes(kind)
        const articled = (LawApi.ARTICLED as readonly string[]).includes(kind)
        const id =
          input.id ??
          (statute && input.name
            ? yield* resolve(call, input.name, [kind]).pipe(
                Effect.mapError(failure),
                Effect.flatMap(({ found, others }) =>
                  found
                    ? Effect.succeed(found.id)
                    : Effect.fail(
                        new ToolFailure({
                          message: `「${input.name}」을(를) 찾지 못했습니다.${others.length ? ` 비슷한 이름: ${others.join(", ")}` : ""} law_search로 찾아 id를 주세요.`,
                        }),
                      ),
                ),
              )
            : undefined)

        if (!id) return yield* new ToolFailure({ message: "Give the id law_search found, or a statute's exact name." })
        const wanted = input.articles ?? []
        const refs = wanted.flatMap((text) => {
          const ref = LawCitation.article(text)

          return ref ? [ref] : []
        })
        const unreadable = wanted.filter((text) => !LawCitation.article(text))

        if (!articled || refs.length === 0) {
          const document = yield* read(call, kind, id).pipe(Effect.mapError(failure))

          return {
            output: { configured: true, name: document.name, link: document.link, missing: unreadable },
            content: documentContent(document, "headings", unreadable),
          }
        }
        const { document, articles } = yield* readArticles(call, { kind, id }, refs).pipe(Effect.mapError(failure))
        const missing = [
          ...refs.flatMap((ref, index) => (articles[index] ? [] : [LawCitation.label(ref)])),
          ...unreadable,
        ]

        return {
          output: { configured: true, name: document.name, link: document.link, missing },
          content: documentContent(
            document,
            articles.flatMap((item) => (item ? [item] : [])),
            missing,
          ),
        }
      }),
  }

  const verifyTool = {
    name: "law_verify",
    options: { codemode: false },
    description:
      "Check, before giving the user an answer or document that cites laws or cases, that every article it cites as 「name」 제N조 (제M항 제K호) exists in the current official text, and that every case it cites by number (2013다61381, 2020헌바123) is on record and was not changed by a later en banc judgment. Fix each one reported missing, unknown or changed, or mark it (확인 필요).",
    input: VerifyInput,
    output: VerifyOutput,
    execute: (input: typeof VerifyInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call) return { output: { configured: false, checks: [] }, content: NOT_SET }
        const citations = LawCitation.find(input.text).slice(0, MAX_CITATIONS)
        const numbers = LawCases.find(input.text)
        const year = new Date().getFullYear()
        const cases = yield* Effect.forEach(
          numbers.slice(0, MAX_CASES),
          (number) =>
            remember(`case\0${number}`, 24 * HOUR, LawCases.check(call, number, year)).pipe(
              Effect.catch((error: LawApi.LawError) =>
                Effect.succeed({ number, result: "unknown" as const, note: `확인하지 못했습니다: ${error.reason}` }),
              ),
            ),
          { concurrency: 3 },
        )
        const names = [...new Map(citations.map((item) => [LawCitation.key(item.name), item.name])).values()]
        const checks = new Map<string, Check>()

        yield* Effect.forEach(
          names,
          (name) =>
            Effect.gen(function* () {
              const cited = citations.filter((item) => LawCitation.key(item.name) === LawCitation.key(name))
              const written = (item: LawCitation.Citation) => `「${item.name}」 ${LawCitation.label(item)}`
              const { found, others } = yield* resolve(call, name, kindsFor(name))

              if (!found) {
                for (const item of cited)
                  checks.set(written(item), {
                    citation: written(item),
                    result: "unknown",
                    note: `이 이름의 현행 법령·자치법규·행정규칙을 찾지 못했습니다${others.length ? ` (비슷한 이름: ${others.join(", ")})` : ""}`,
                  })
                return
              }
              const { articles } = yield* readArticles(call, found, cited)

              cited.forEach((item, index) => {
                const article = articles[index]
                const problem = article ? locate(article, item) : `${KIND_NAMES[found.kind]}에 없는 조문입니다`
                const gone = article !== undefined && !problem && removed(article, item)

                checks.set(written(item), {
                  citation: written(item),
                  result: !article ? "missing" : article.deleted || gone ? "deleted" : problem ? "missing" : "ok",
                  note: !article
                    ? `「${found.name}」에 없는 조문입니다`
                    : article.deleted
                      ? "삭제된 조문입니다"
                      : gone
                        ? `${LawCitation.label(item)}은(는) 삭제되었습니다`
                        : (problem ??
                          `있음: ${article.heading}${article.effective ? ` [시행 ${article.effective}]` : ""}`),
                })
              })
            }).pipe(
              Effect.catch((error: LawApi.LawError) =>
                Effect.sync(() => {
                  for (const item of citations.filter((entry) => LawCitation.key(entry.name) === LawCitation.key(name)))
                    checks.set(`「${item.name}」 ${LawCitation.label(item)}`, {
                      citation: `「${item.name}」 ${LawCitation.label(item)}`,
                      result: "unknown",
                      note: `확인하지 못했습니다: ${error.reason}`,
                    })
                }),
              ),
            ),
          { concurrency: 3 },
        )
        const ordered = [
          ...citations.flatMap((item) => {
            const check = checks.get(`「${item.name}」 ${LawCitation.label(item)}`)

            return check ? [check] : []
          }),
          ...cases.map((item) => ({ citation: item.number, result: item.result, note: item.note })),
          ...numbers.slice(MAX_CASES).map((number) => ({
            citation: number,
            result: "unknown" as const,
            note: `한 번에 확인하는 사건번호 ${MAX_CASES}개를 넘어 확인하지 않았습니다`,
          })),
        ]

        return { output: { configured: true, checks: ordered }, content: checksContent(ordered) }
      }),
  }

  const amendTool = {
    name: "law_amend",
    options: { codemode: false },
    description:
      "Make the 신·구조문대비표 (comparison table of current and amended text) for a partial amendment of a law, ordinance or rule: give each article as it will read, and it takes the current text from law.go.kr, underlines what changes and writes the rest of the amendment as dashes, as 법제처's 법제업무편람 lays it out, and saves it as a Hangul file when asked.",
    input: AmendInput,
    output: AmendOutput,
    execute: (
      input: typeof AmendInput.Type,
      context?: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">,
    ) =>
      Effect.gen(function* () {
        const kind = input.kind ?? "law"
        const proposals = input.amendments.map((item) => ({ ...item, article: LawAmendment.parse(item.text) }))
        const unnumbered = proposals.filter((item) => !item.article.number)

        if (unnumbered.length)
          return yield* new ToolFailure({
            message: `Start each amendment's text with its article, such as 제5조(목적): ${unnumbered.map((item) => item.text.slice(0, 20)).join(", ")}`,
          })
        const numbers = proposals.map((item) => item.article.number)
        const twice = numbers.filter((number, index) => numbers.indexOf(number) !== index)

        if (twice.length)
          return yield* new ToolFailure({ message: `Give each article once: ${[...new Set(twice)].join(", ")}` })
        if (input.file !== undefined && !/\.hwpx$/i.test(input.file))
          return yield* new ToolFailure({ message: "file must end in .hwpx" })
        if (input.file !== undefined && (!deps.save || !context))
          return yield* new ToolFailure({ message: "This session cannot save files; leave file out." })
        const fetching = proposals.some((item) => item.current === undefined)
        const call = fetching ? yield* transport : undefined

        if (fetching && !call)
          return { output: { configured: false, title: input.title ?? "", notes: [] }, content: NOT_SET }
        const refs = proposals.map((item) => LawCitation.article(item.article.number)!)
        const resolved =
          call && (input.id || input.name)
            ? input.id
              ? { id: input.id, name: input.name }
              : yield* resolve(call, input.name!, [kind]).pipe(
                  Effect.mapError(failure),
                  Effect.flatMap(({ found, others }) =>
                    found
                      ? Effect.succeed({ id: found.id, name: found.name })
                      : Effect.fail(
                          new ToolFailure({
                            message: `「${input.name}」을(를) ${KIND_NAMES[kind]}에서 찾지 못했습니다.${others.length ? ` 비슷한 이름: ${others.join(", ")}` : ""} law_search로 찾아 id를 주세요.`,
                          }),
                        ),
                  ),
                )
            : undefined

        if (call && !resolved)
          return yield* new ToolFailure({
            message:
              "Give what is amended by its id from law_search or its exact name, or give every article's current text.",
          })
        const fetched =
          call && resolved
            ? yield* readArticles(call, { kind, id: resolved.id }, refs).pipe(Effect.mapError(failure))
            : undefined
        const name = fetched?.document.name ?? resolved?.name ?? input.name ?? ""
        const notes: string[] = []
        const built = proposals.map((item, index) => {
          const found = fetched?.articles[index]
          const current =
            item.current !== undefined
              ? item.current.trim()
                ? LawAmendment.parse(item.current)
                : undefined
              : found
                ? LawAmendment.parse(LawAmendment.text(found))
                : undefined

          if (item.current === undefined && !found)
            notes.push(`${item.article.number}: 현행에 없는 조라 신설로 적었습니다. 번호가 맞는지 확인하세요`)

          return {
            ref: refs[index]!,
            rows: LawAmendment.rows(current, item.article, notes),
            number: item.article.number,
          }
        })

        for (const item of built) if (!item.rows) notes.push(`${item.number}: 현행과 같아 표에서 뺐습니다`)
        const articles = built
          .filter((item) => item.rows)
          .sort((a, b) => a.ref.article - b.ref.article || (a.ref.branch ?? 0) - (b.ref.branch ?? 0))
          .map((item) => item.rows!)
        const title = input.title?.trim() || (name ? LawAmendment.title(name, kind === "ordinance") : "일부개정안")

        if (fetched) notes.push(`현행: 국가법령정보센터 「${name}」 (${fetched.document.detail})의 조문과 대조했습니다`)
        const saved =
          input.file !== undefined && articles.length
            ? yield* deps.save!(input.file, AmendmentHwpx.document([title, "신·구조문대비표"], articles), context!)
            : undefined

        return {
          output: { configured: true, title, ...(saved ? { file: saved } : {}), notes },
          content: amendContent(title, articles, notes, saved),
        }
      }),
  }

  // A law's versions, which history lists and as_of picks from; a law with none is not one law.go.kr dates.
  const versions = (call: LawApi.Transport, id: string) =>
    remember(`versions\0${id}`, 24 * HOUR, LawCompare.versions(call, id)).pipe(
      Effect.mapError(failure),
      Effect.filterOrFail(
        (rows) => rows.length > 0,
        () =>
          new ToolFailure({ message: `법제처에 ${id}의 연혁이 없습니다. law_search(kind law)로 찾은 id를 주세요.` }),
      ),
    )

  const compareTool = {
    name: "law_compare",
    options: { codemode: false },
    description:
      "Trace a law beyond its current text, as law.go.kr works it out: what its latest amendment changed (신구법 비교), the decree and rule articles that carry out each of its articles (3단 비교), the decrees, rules and administrative rules made under it (법령 체계도), its amendments over time (연혁), or its articles as in force on a past date (행위시법); or check a local ordinance against the laws it carries out (조례 정비 점검).",
    input: CompareInput,
    output: CompareOutput,
    execute: (input: typeof CompareInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call) return { output: { configured: false, missing: [] }, content: NOT_SET }
        const kind = input.mode === "ordinance" ? "ordinance" : "law"
        const id =
          input.id ??
          (input.name
            ? yield* resolve(call, input.name, [kind]).pipe(
                Effect.mapError(failure),
                Effect.flatMap(({ found, others }) =>
                  found
                    ? Effect.succeed(found.id)
                    : Effect.fail(
                        new ToolFailure({
                          message: `「${input.name}」을(를) ${KIND_NAMES[kind]}에서 찾지 못했습니다.${others.length ? ` 비슷한 이름: ${others.join(", ")}` : ""} law_search로 찾아 id를 주세요.`,
                        }),
                      ),
                ),
              )
            : undefined)

        if (!id) return yield* new ToolFailure({ message: `Give the ${kind}'s id from law_search, or its exact name.` })
        switch (input.mode) {
          case "ordinance": {
            const ordinance = yield* remember(`ordinance\0${id}`, 24 * HOUR, LawCompare.ordinance(call, id)).pipe(
              Effect.mapError(failure),
            )
            const laws = yield* Effect.forEach(
              ordinance.laws,
              (name) =>
                resolve(call, name, ["law"]).pipe(
                  Effect.flatMap(({ found }) =>
                    found
                      ? remember(`versions\0${found.id}`, 24 * HOUR, LawCompare.versions(call, found.id)).pipe(
                          Effect.map((rows) => ({ name, found, rows })),
                        )
                      : Effect.succeed({ name }),
                  ),
                  Effect.catch((error: LawApi.LawError) =>
                    Effect.succeed({ name, error: `확인하지 못했습니다: ${error.reason}` }),
                  ),
                ),
              { concurrency: 3 },
            )

            return {
              output: { configured: true, name: ordinance.name, missing: [] },
              content: ordinanceContent(
                ordinance,
                laws,
                LawCompare.day(new Date(Date.now() + KST).toISOString().slice(0, 10)) ?? "",
              ),
            }
          }
          case "changes": {
            const changes = yield* remember(`changes\0${id}`, 24 * HOUR, LawCompare.changes(call, id)).pipe(
              Effect.mapError(failure),
            )

            return { output: { configured: true, name: changes.name, missing: [] }, content: changesContent(changes) }
          }
          case "delegation": {
            const delegation = yield* remember(`delegation\0${id}`, 24 * HOUR, LawCompare.delegation(call, id)).pipe(
              Effect.mapError(failure),
            )
            const wanted = input.articles ?? []
            const refs = wanted.flatMap((text) => {
              const ref = LawCitation.article(text)

              return ref ? [ref] : []
            })
            const missing = [
              ...refs.flatMap((ref) =>
                delegation.articles.some((item) => LawCompare.isArticle(item, ref)) ? [] : [LawCitation.label(ref)],
              ),
              ...wanted.filter((text) => !LawCitation.article(text)),
            ]

            return {
              output: { configured: true, name: delegation.name, missing },
              content: delegationContent(delegation, refs, missing),
            }
          }
          case "system": {
            const system = yield* remember(`system\0${id}`, 24 * HOUR, LawCompare.system(call, id)).pipe(
              Effect.mapError(failure),
            )

            return { output: { configured: true, name: system.name, missing: [] }, content: systemContent(system) }
          }
          case "history": {
            const rows = yield* versions(call, id)

            return { output: { configured: true, name: rows[0]!.name, missing: [] }, content: historyContent(rows) }
          }
          case "as_of": {
            const on = input.date === undefined ? undefined : LawCompare.day(input.date)

            if (!on) return yield* new ToolFailure({ message: "Give the date for as_of, such as 2024-01-01." })
            const rows = yield* versions(call, id)
            const row = LawCompare.inForce(rows, on)

            if (!row)
              return yield* new ToolFailure({
                message: `${LawApi.date(on)}에는 「${rows.at(-1)!.name}」이(가) 아직 시행되지 않았습니다 (처음 시행 ${LawApi.date(rows.at(-1)!.effective)}).`,
              })
            const header = `${LawApi.date(on)}에 시행 중이던 판: ${versionLine(row)}`

            if (row.change.includes("폐지"))
              return {
                output: { configured: true, name: row.name, missing: [] },
                content: `${header}\n「${row.name}」은(는) 그날 이미 폐지된 상태였습니다.`,
              }
            const at = (article?: string) =>
              remember(
                `at\0${row.mst}\0${row.effective}\0${article ?? ""}`,
                24 * HOUR,
                LawApi.documentAt(call, { id, mst: row.mst, effective: row.effective, article }),
              ).pipe(Effect.mapError(failure))
            const wanted = input.articles ?? []
            const refs = wanted.flatMap((text) => {
              const ref = LawCitation.article(text)

              return ref ? [ref] : []
            })
            const unreadable = wanted.filter((text) => !LawCitation.article(text))

            if (refs.length === 0) {
              const document = yield* at()

              return {
                output: { configured: true, name: document.name, missing: unreadable },
                content: `${header}\n\n${documentContent(document, "headings", unreadable)}`,
              }
            }
            const documents = yield* Effect.forEach(refs, (ref) => at(LawCitation.code(ref)), { concurrency: 4 })
            const articles = refs.map((ref, index) => articleOf(documents[index]!.articles, ref))
            const missing = [
              ...refs.flatMap((ref, index) => (articles[index] ? [] : [LawCitation.label(ref)])),
              ...unreadable,
            ]

            return {
              output: { configured: true, name: documents[0]!.name, missing },
              content: `${header}\n\n${documentContent(
                documents[0]!,
                articles.flatMap((item) => (item ? [item] : [])),
                missing,
              )}`,
            }
          }
        }
      }),
  }

  return { search: searchTool, text: textTool, compare: compareTool, amend: amendTool, verify: verifyTool }
}
