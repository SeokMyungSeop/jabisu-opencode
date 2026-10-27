export * as LawTools from "./tools.js"

import { ToolFailure } from "@opencode/ai"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { LawApi } from "./api.js"
import { LawCitation } from "./citation.js"
import { LawSettings } from "./settings.js"

// The law tools every 자비수 session has: search the official law database, read articles in their official words,
// and check that the articles an answer cites exist. Answers about what a law says rest on these, not on what the
// model remembers.

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Pick<Global.Interface, "config">
  readonly http: HttpClient.HttpClient
}

const KIND = Schema.Literals(LawApi.KINDS)

const KIND_NAMES = {
  law: "법령",
  ordinance: "자치법규",
  rule: "행정규칙",
  precedent: "판례",
  interpretation: "법령해석례",
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

const HOUR = 3_600_000
const MAX_CACHED = 200

export const SearchInput = Schema.Struct({
  query: Schema.String.annotate({
    description: "Words to search for, such as a law's name (보조금 관리에 관한 법률) or a topic (바이오 육성)",
  }),
  kind: Schema.optional(KIND).annotate({
    description:
      "law: laws and decrees (default); ordinance: local ordinances and rules (조례·규칙); rule: administrative rules (고시·훈령·예규·지침); precedent: court precedents; interpretation: 법제처 interpretations",
  }),
  text: Schema.optional(Schema.Boolean).annotate({
    description: "Search the text instead of names (precedents are always searched by text)",
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

export const VerifyInput = Schema.Struct({
  text: Schema.String.annotate({
    description: "The answer or document text whose citations to check, with names in 「」",
  }),
})

const RESULTS = ["ok", "missing", "deleted", "unknown"] as const

export const VerifyOutput = Schema.Struct({
  configured: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({ citation: Schema.String, result: Schema.Literals(RESULTS), note: Schema.String }),
  ),
})

export type Check = { readonly citation: string; readonly result: (typeof RESULTS)[number]; readonly note: string }

const failure = (error: LawApi.LawError) => new ToolFailure({ message: error.reason })

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
        : document.sections.map((section) => `[${section.label}]\n${cut(section.text, MAX_SECTION_CHARS, document.link)}`)
      : articles.map((item) => `${item.text}${item.effective ? `\n[시행 ${item.effective}]` : ""}`)

  return cut(
    [
      `「${document.name}」 (${document.detail}) ${document.link}`,
      "",
      ...body,
      ...(missing.length ? ["", `Not in this text: ${missing.join(", ")}`] : []),
      "",
      "Quote only these words, with the 시행일, and cite as 「name」 제N조 제M항.",
    ].join("\n"),
    MAX_CHARS,
    document.link,
  )
}

/** The citation checks as the model reads them. */
export function checksContent(checks: readonly Check[]) {
  if (checks.length === 0)
    return "No citations found. Write each as 「법령명」 제N조 (제M항 제K호); only names in 「」 are checked."
  const marks = { ok: "✓", missing: "✗", deleted: "✗", unknown: "?" } as const

  return [
    ...checks.map((check) => `${marks[check.result]} ${check.citation} — ${check.note}`),
    "",
    checks.every((check) => check.result === "ok")
      ? "Every citation exists in the current official text."
      : "Fix each ✗ and ? before giving the answer, or mark it (확인 필요); read the article with law_text.",
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

  const search = (call: LawApi.Transport, input: Parameters<typeof LawApi.search>[1]) =>
    remember(`search\0${JSON.stringify(input)}`, HOUR, LawApi.search(call, input))

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

  const searchTool = {
    name: "law_search",
    options: { codemode: false },
    description:
      "Search Korea's official law database (국가법령정보센터, law.go.kr of 법제처): laws and decrees, local ordinances (자치법규), administrative rules (고시·훈령·예규), court precedents and 법제처 interpretations. Use it whenever an answer depends on what a law, ordinance or rule says, and do not quote laws from memory. Then read the articles with law_text.",
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
        const result = yield* search(call, {
          kind,
          query: input.query,
          limit: input.limit ?? 10,
          ...(input.text ? { text: true } : {}),
        }).pipe(Effect.mapError(failure))

        return {
          output: {
            configured: true,
            total: result.total,
            found: result.found.map(({ short: _short, ...item }) => item),
          },
          content: searchContent(kind, result.total, result.found),
        }
      }),
  }

  const textTool = {
    name: "law_text",
    options: { codemode: false },
    description:
      "Read the official text of a law, ordinance or rule: the articles asked for, such as 제11조 or 제26조의2, or its list of articles when none are given; or a precedent or interpretation law_search found. Quote only these words, with the 시행일.",
    input: TextInput,
    output: TextOutput,
    execute: (input: typeof TextInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call) return { output: { configured: false, missing: [] }, content: NOT_SET }
        const kind = input.kind ?? "law"
        const statute = (LawApi.STATUTES as readonly string[]).includes(kind)
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

        if (!statute || refs.length === 0) {
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
      "Check, before giving the user an answer or document that cites laws, that every article it cites as 「name」 제N조 (제M항 제K호) exists in the current official text. Fix each one reported missing or unknown, or mark it (확인 필요).",
    input: VerifyInput,
    output: VerifyOutput,
    execute: (input: typeof VerifyInput.Type) =>
      Effect.gen(function* () {
        const call = yield* transport

        if (!call) return { output: { configured: false, checks: [] }, content: NOT_SET }
        const citations = LawCitation.find(input.text).slice(0, MAX_CITATIONS)
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

                checks.set(written(item), {
                  citation: written(item),
                  result: !article ? "missing" : article.deleted ? "deleted" : problem ? "missing" : "ok",
                  note: !article
                    ? `「${found.name}」에 없는 조문입니다`
                    : article.deleted
                      ? "삭제된 조문입니다"
                      : (problem ?? `있음: ${article.heading}${article.effective ? ` [시행 ${article.effective}]` : ""}`),
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
        const ordered = citations.flatMap((item) => {
          const check = checks.get(`「${item.name}」 ${LawCitation.label(item)}`)

          return check ? [check] : []
        })

        return { output: { configured: true, checks: ordered }, content: checksContent(ordered) }
      }),
  }

  return { search: searchTool, text: textTool, verify: verifyTool }
}
