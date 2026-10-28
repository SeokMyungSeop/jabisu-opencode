export * as Jiphyeonjeon from "./jiphyeonjeon.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { artifactKind } from "@opencode/util/artifact"
import { DocumentText } from "@opencode/util/document-text"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Global } from "@opencode/util/global"
import { Transcribe } from "../../tool/transcribe.js"
import { DocumentExtract } from "./document-extract.js"

// 자비수 집현전(集賢殿): a folder of sources the user asks about, like a NotebookLM notebook kept on the PC. Each one is
// `<Documents>/자비수 집현전/<name>/` with the sources under `자료/` and an AGENTS.md that OpenCode loads as the
// instructions of every session opened there: fixed rules for answering from the sources, then the user's own.

export const MARKER = "<!-- jabisu:jiphyeonjeon -->"
// Writes suggested instructions on OpenRouter in a few seconds for well under a won.
export const SUGGEST_MODEL = "xiaomi/mimo-v2.6-flash"
export const SOURCES = "자료"
const HEADING = "## 지침"
const NO_INSTRUCTIONS = "(사용자 지침 없음)"

export class JiphyeonjeonError extends Schema.TaggedError<JiphyeonjeonError>()("Jiphyeonjeon.JiphyeonjeonError", {
  reason: Schema.String,
}) {}

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
}

/** The folder that holds every 집현전. */
export const root = (global: Pick<Global.Interface, "home">) => path.join(global.home, "Documents", "자비수 집현전")

/** The AGENTS.md of a 집현전: the rules, then the user's instructions under `## 지침`. */
export function agents(name: string, instructions: string) {
  return [
    MARKER,
    `# 집현전: ${name}`,
    "",
    `이 폴더는 자비수 집현전이다. 사용자는 \`${SOURCES}\` 폴더의 자료를 바탕으로 묻는다.`,
    "",
    "- 자료는 source_search 도구로 찾고, 필요하면 read 도구로 그 줄 앞뒤를 읽는다. 자료를 보려고 셸이나 파이썬으로 파일을 풀거나 변환하지 않는다.",
    "- 프로그램이나 패키지를 설치해야 하면 설치하기 전에 사용자에게 묻는다.",
    "- 자료에 있는 내용으로 답하고, 근거가 되는 문장 끝에 source_search가 알려 준 꼴의 출처 링크를 단다. 예: [사업계획서.pdf · 3쪽](<자료/사업계획서.pdf>). 위치는 도구가 알려 준 쪽·장·조·슬라이드·시트·시각을 쓰고, 그것이 없을 때만 줄을 쓴다.",
    "- 출처를 달 수 없는 문장은 쓰지 않는다. 낱말 풀이처럼 자료 밖 설명이 꼭 필요하면 그 문장 끝에 「(자료 밖)」이라고 쓴다.",
    "- 자료에 없는 해석·평가·추측을 덧붙이지 않는다. 자료의 말을 바꾸어 쓸 때도 뜻을 넓히거나 좁히지 않고, 숫자·날짜·이름·조항은 자료에 적힌 그대로 쓴다.",
    "- 자료끼리 다르게 말하면 한쪽을 고르지 말고 둘 다 출처와 함께 보여 준다.",
    '- "자료에 없습니다"라고 하기 전에 자료에 쓰였을 법한 말, 비슷한 말, 줄인 말로 source_search를 두세 번 더 찾는다. 그래도 없으면 "자료에 없습니다"라고 답하고, 검색하지 못한 자료나 글자 없는 쪽이 있으면 그것은 확인하지 못했다고 함께 알린다. 웹에서 찾아볼지 사용자에게 묻고, 사용자가 원할 때만 웹을 찾으며, 그 내용은 자료 밖이라고 밝힌다.',
    "- 녹음 파일은 read 도구로 한 번 읽어야 받아쓰기가 만들어지고, 그다음부터 검색된다.",
    `- \`${SOURCES}\` 폴더의 파일은 지우거나 고치지 않는다. 새로 만드는 문서는 \`결과\` 폴더에 둔다.`,
    "",
    HEADING,
    "",
    instructions.trim() || NO_INSTRUCTIONS,
    "",
  ].join("\n")
}

/** The user's own instructions in a 집현전's AGENTS.md: everything under its `## 지침` heading. */
export function instructions(text: string) {
  // Editors on Windows may save the file with CRLF line ends.
  const normalized = text.replaceAll("\r\n", "\n")
  const start = normalized.indexOf(`\n${HEADING}\n`)
  if (start < 0) return ""
  const body = normalized.slice(start + HEADING.length + 2).trim()
  return body === NO_INSTRUCTIONS ? "" : body
}

export const isJiphyeonjeon = (text: string | undefined) => text?.startsWith(MARKER) === true

// A 집현전 is a folder, so its name must be a valid Windows file name.
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** The trimmed name when it can name a folder, else undefined. */
export function folderName(name: string) {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80 || trimmed.startsWith(".") || /[. ]$/.test(trimmed)) return undefined
  if (INVALID.test(trimmed) || RESERVED.test(trimmed)) return undefined
  return trimmed
}

const agentsFile = (directory: string) => path.join(directory, "AGENTS.md")

/** Brings an older 집현전's rules up to this version's, keeping the user's instructions. */
export const refresh = Effect.fn("Jiphyeonjeon.refresh")(function* (
  deps: Dependencies,
  directory: string,
  text: string,
) {
  const current = agents(path.basename(directory), instructions(text))
  if (text.replaceAll("\r\n", "\n") === current) return
  yield* deps.fs.writeWithDirs(agentsFile(directory), current).pipe(Effect.ignore)
})

/** One 집현전 as the app lists it; undefined for a folder that is not one. */
const describe = Effect.fn("Jiphyeonjeon.describe")(function* (deps: Dependencies, directory: string) {
  const text = yield* deps.fs.readFileStringSafe(agentsFile(directory)).pipe(Effect.orElseSucceed(() => undefined))
  if (!text || !isJiphyeonjeon(text)) return undefined
  yield* refresh(deps, directory, text)
  const files = yield* sourceFiles(deps, directory)
  return {
    name: path.basename(directory),
    directory,
    instructions: instructions(text),
    sources: files.map((file) => sourcePath(directory, file)),
  }
})

// A source's path under the sources folder, with `/`.
const sourcePath = (directory: string, file: string) =>
  path.relative(path.join(directory, SOURCES), file).replaceAll("\\", "/")

const sourceFiles = (deps: Dependencies, directory: string) =>
  deps.fs.scan("**/*", { cwd: path.join(directory, SOURCES), include: "file", absolute: true }).pipe(
    Effect.map((files) => files.toSorted()),
    Effect.orElseSucceed(() => [] as string[]),
  )

/** Every 집현전 under the root, by name. */
export const list = Effect.fn("Jiphyeonjeon.list")(function* (deps: Dependencies) {
  const base = root(deps.global)
  const entries = yield* deps.fs.readDirectoryEntries(base).pipe(Effect.orElseSucceed(() => []))
  const items = yield* Effect.forEach(
    entries.filter((entry) => entry.type === "directory"),
    (entry) => describe(deps, path.join(base, entry.name)),
    { concurrency: 4 },
  )
  return {
    root: base,
    items: items.filter((item) => item !== undefined).toSorted((a, b) => a.name.localeCompare(b.name)),
  }
})

const existing = Effect.fn("Jiphyeonjeon.existing")(function* (deps: Dependencies, name: string) {
  const folder = folderName(name)
  const item = folder ? yield* describe(deps, path.join(root(deps.global), folder)) : undefined
  if (!item) return yield* new JiphyeonjeonError({ reason: `there is no 집현전 named ${name}` })
  return item
})

/** Makes an empty 집현전 with its sources folder and rules. */
export const create = Effect.fn("Jiphyeonjeon.create")(function* (
  deps: Dependencies,
  input: { readonly name: string },
) {
  const name = folderName(input.name)
  if (!name)
    return yield* new JiphyeonjeonError({
      reason: 'a 집현전 name must be a folder name of up to 80 characters, without \\ / : * ? " < > |',
    })
  const directory = path.join(root(deps.global), name)
  if (yield* deps.fs.existsSafe(directory)) return yield* new JiphyeonjeonError({ reason: `${name} already exists` })
  yield* Effect.all([
    deps.fs.ensureDir(path.join(directory, SOURCES)),
    deps.fs.writeWithDirs(agentsFile(directory), agents(name, "")),
  ]).pipe(Effect.mapError(() => new JiphyeonjeonError({ reason: `${directory} cannot be written` })))
  return yield* existing(deps, name)
})

/** Replaces the user's instructions, rewriting the rules above them to the current ones. */
export const instruct = Effect.fn("Jiphyeonjeon.instruct")(function* (
  deps: Dependencies,
  input: { readonly name: string; readonly instructions: string },
) {
  const item = yield* existing(deps, input.name)
  yield* deps.fs
    .writeWithDirs(agentsFile(item.directory), agents(item.name, input.instructions))
    .pipe(Effect.mapError(() => new JiphyeonjeonError({ reason: `${item.directory} cannot be written` })))
  return yield* existing(deps, input.name)
})

const MAX_SOURCES = 1_000
const MAX_LINE = 300
const CACHED_TEXTS = 256

// Converted text by file version, so repeated searches skip the conversion. Insertion order is the eviction order.
const texts = new Map<string, { readonly text: string; readonly blank: readonly number[] }>()

/**
 * A source as search sees it: its text with the PDF pages that have none, or why there is no text. `pending` is a
 * recording not transcribed yet, `unsupported` a file that is neither text nor a document, and `unreadable` a document
 * that could not be converted.
 */
export type Converted =
  | { readonly status: "ready"; readonly text: string; readonly blank: readonly number[] }
  | { readonly status: "pending" | "unsupported" | "unreadable"; readonly reason: string }

const sourceText = Effect.fn("Jiphyeonjeon.sourceText")(function* (
  deps: Dependencies,
  file: string,
): Effect.fn.Return<Converted> {
  const info = yield* deps.fs.stat(file).pipe(Effect.option)
  if (Option.isNone(info)) return { status: "unreadable", reason: "it cannot be read" }
  const kind = artifactKind(file)

  // A search never pays for a transcript; reading the recording makes one.
  if (kind === "audio" || kind === "video") {
    const transcript = yield* Transcribe.existing(deps, file)
    if (transcript === undefined)
      return { status: "pending", reason: "not transcribed yet; read it once with the read tool" }
    return { status: "ready", text: transcript, blank: [] }
  }

  if (info.value.size > DocumentText.MAX_DOCUMENT_BYTES)
    return { status: "unreadable", reason: `larger than ${DocumentText.MAX_DOCUMENT_BYTES / 1024 / 1024} MiB` }
  const key = `${file}\0${info.value.size}\0${Option.getOrUndefined(info.value.mtime)?.getTime() ?? 0}`
  const hit = texts.get(key)
  if (hit !== undefined) return { status: "ready", ...hit }

  const bytes = yield* deps.fs.readFile(file).pipe(Effect.option)
  if (Option.isNone(bytes)) return { status: "unreadable", reason: "it cannot be read" }
  const extracted = yield* DocumentExtract.fromBytes(file, bytes.value)
  if (extracted.status !== "ready") return extracted

  texts.set(key, { text: extracted.text, blank: extracted.blank })
  if (texts.size > CACHED_TEXTS) texts.delete(texts.keys().next().value ?? key)
  return extracted
})

/** Each source of a 집현전 with whether search can read it, for the app's list. */
export const sources = Effect.fn("Jiphyeonjeon.sources")(function* (
  deps: Dependencies,
  input: { readonly name: string },
) {
  const item = yield* existing(deps, input.name)
  const files = yield* sourceFiles(deps, item.directory)
  return yield* Effect.forEach(
    files.slice(0, MAX_SOURCES),
    (file) =>
      sourceText(deps, file).pipe(
        Effect.map((result) =>
          result.status === "ready"
            ? {
                path: sourcePath(item.directory, file),
                status: result.status,
                ...(result.blank.length ? { blank: result.blank } : {}),
              }
            : { path: sourcePath(item.directory, file), status: result.status, reason: result.reason },
        ),
      ),
    { concurrency: 4 },
  )
})

// Where a line sits in converted text, to cite it: the page, slide or sheet it is on, the chapter and the article or
// numbered heading above it, or a transcript line's own time. Contents lines with dot leaders are not headings.
const PAGE = /^## Page (\d+)$/
const SLIDE = /^## Slide (\d+)/
const SHEET = /^## Sheet: (.+?)(?: \(hidden\))?$/
const CHAPTER = /^제\s*(\d+)\s*장(?:\s|$)/
const SECTION = /^제\s*(\d+)\s*절(?:\s|$)/
const ARTICLE = /^제\s*(\d+)\s*조(?:의\s*(\d+))?\s*[(（]/
const NUMBERED = /^\d+\.\s+\S/
const MARKDOWN = /^#{1,6}\s+(.+)$/
const LEADERS = /[·․.…]{3,}/
const TIME = /^\[(\d{2}:\d{2}:\d{2})\]/

const short = (text: string) => (text.length > 24 ? `${text.slice(0, 23)}…` : text)

interface Place {
  readonly page?: string
  readonly chapter?: string
  readonly heading?: string
}

function step(place: Place, line: string): Place {
  if (LEADERS.test(line)) return place
  const page = PAGE.exec(line)
  if (page) return { ...place, page: `${page[1]}쪽` }
  const slide = SLIDE.exec(line)
  if (slide) return { page: `슬라이드 ${slide[1]}` }
  const sheet = SHEET.exec(line)
  if (sheet) return { page: `시트 ${sheet[1]}` }
  // Hangul documents read through kordoc mark chapters and sections as Markdown headings: `### 제5장 …`.
  const markdown = MARKDOWN.exec(line)
  const text = markdown ? markdown[1].trim() : line
  const chapter = CHAPTER.exec(text)
  if (chapter) return { page: place.page, chapter: `제${chapter[1]}장` }
  const section = SECTION.exec(text)
  if (section) return { ...place, heading: `제${section[1]}절` }
  const article = ARTICLE.exec(text)
  if (article) return { ...place, heading: `제${article[1]}조${article[2] ? `의${article[2]}` : ""}` }
  if (markdown || NUMBERED.test(text)) return { ...place, heading: short(text.trim()) }
  return place
}

function label(place: Place) {
  if (place.page) return place.heading ? `${place.page} · ${place.heading}` : place.page
  return [place.chapter, place.heading].filter(Boolean).join(" › ") || undefined
}

export interface Match {
  readonly file: string
  readonly location?: string
  readonly line: number
  readonly text: string
}

/**
 * Lines of the 집현전's sources with the query's words: lines with more of the words first, then lines that hold the
 * whole query, taking each source's next best line in turn so one long source does not crowd out the rest. Documents
 * search as the text the read tool shows, so a match's line is the line to read.
 */
export const search = Effect.fn("Jiphyeonjeon.search")(function* (
  deps: Dependencies,
  directory: string,
  input: { readonly query: string; readonly limit: number },
) {
  const phrase = input.query.trim().toLowerCase()
  const terms = [...new Set(phrase.split(/\s+/).filter(Boolean))]
  const every = yield* sourceFiles(deps, directory)
  const files = every.slice(0, MAX_SOURCES)
  const converted = yield* Effect.forEach(
    files,
    (file) => sourceText(deps, file).pipe(Effect.map((result) => ({ file, result }))),
    { concurrency: 4 },
  )
  const name = (file: string) => path.relative(directory, file).replaceAll("\\", "/")
  const found = converted.map(({ file, result }) => {
    if (result.status !== "ready") return []
    const lines = result.text.split("\n")
    const places = lines.reduce<Place[]>((all, line) => {
      all.push(step(all.at(-1) ?? {}, line))
      return all
    }, [])
    const hits = lines.flatMap((line, index) => {
      const lower = line.toLowerCase()
      const score =
        terms.filter((term) => lower.includes(term)).length + (terms.length > 1 && lower.includes(phrase) ? 1 : 0)
      if (score === 0) return []
      const text = line.trim()
      return [
        {
          score,
          file: name(file),
          location: TIME.exec(text)?.[1] ?? label(places[index]),
          line: index + 1,
          text: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text,
        },
      ]
    })
    // Each line's rank among its own source's lines with the same score, so sources take turns.
    const ranks = new Map<number, number>()
    return hits.map((hit) => {
      const rank = ranks.get(hit.score) ?? 0
      ranks.set(hit.score, rank + 1)
      return { ...hit, rank }
    })
  })
  const ranked = found.flat().toSorted((a, b) => b.score - a.score || a.rank - b.rank)
  return {
    searched: converted.filter(({ result }) => result.status === "ready").length,
    total: ranked.length,
    files: found.flatMap((hits) => (hits.length ? [{ file: hits[0].file, matches: hits.length }] : [])),
    matches: ranked
      .slice(0, input.limit)
      .map((match): Match => ({ file: match.file, location: match.location, line: match.line, text: match.text })),
    skipped: converted.flatMap(({ file, result }) =>
      result.status === "ready" ? [] : [{ file: name(file), reason: result.reason }],
    ),
    // PDF pages without text, probably scanned images, which no search can find anything on.
    partial: converted.flatMap(({ file, result }) =>
      result.status === "ready" && result.blank.length ? [{ file: name(file), pages: result.blank }] : [],
    ),
    unsearched: every.length - files.length,
  }
})

const DIGEST_PER_SOURCE = 700
const DIGEST_HEADINGS = 12
const DIGEST_TOTAL = 6_000

/**
 * What the sources are about, for writing instructions: each source's name, its first headings, and its opening text.
 * Sources search cannot read yet are named with why.
 */
export function digest(sources: ReadonlyArray<{ readonly path: string; readonly converted: Converted }>) {
  const parts = sources.map(({ path: file, converted }) => {
    if (converted.status !== "ready") return `## ${file}\n(${converted.reason})`
    const lines = converted.text.split("\n").map((line) => line.trim())
    const headings = lines
      .filter((line) => !LEADERS.test(line) && (CHAPTER.test(line) || ARTICLE.test(line) || /^#{1,3}\s/.test(line)))
      .slice(0, DIGEST_HEADINGS)
    const opening = lines.filter(Boolean).join(" ").slice(0, DIGEST_PER_SOURCE)
    return [`## ${file}`, ...headings, opening].join("\n")
  })
  return parts.join("\n\n").slice(0, DIGEST_TOTAL)
}

/** The request for instructions that fit the sources, in P-C-T-F form with F as the shape of each answer. */
export function suggestion(name: string, sources: string) {
  return [
    `다음은 "${name}"이라는 자비수 집현전에 넣은 자료의 이름과 앞부분이다. 이 집현전에서 AI가 사용자의 질문에 답할 때 따를 지침을 써라.`,
    "",
    "- 한국어로 공백 포함 300~400자, 아래 네 줄 형식 그대로 쓴다.",
    "  P(역할): 자료의 분야에 맞는 전문가 역할 한 문장",
    "  C(맥락): 이 자료가 무엇이고 사용자가 어떤 일로 묻는지",
    "  T(작업): 답할 때 할 일 2~3가지. 예: 해당 조문을 찾아 요건·금액·절차를 확인하고, 예외와 시행일을 함께 알린다",
    "  F(답변 양식): 답변의 구조. 예: □ 결론 → o 근거 → - 세부 내용 순서, 비교가 필요하면 표",
    "- 출처를 다는 규칙과 자료에 없는 질문을 다루는 규칙은 따로 있으니 쓰지 않는다.",
    "- 지침 네 줄만 출력하고 다른 말은 쓰지 않는다.",
    "",
    "[자료]",
    sources,
  ].join("\n")
}

/** Instructions that fit a 집현전's sources, written by the given model call; nothing is saved. */
export const suggest = Effect.fn("Jiphyeonjeon.suggest")(function* (
  deps: Dependencies,
  input: { readonly name: string },
  generate: (prompt: string) => Effect.Effect<string, { readonly message: string }>,
) {
  const item = yield* existing(deps, input.name)
  const files = yield* sourceFiles(deps, item.directory)
  if (files.length === 0)
    return yield* new JiphyeonjeonError({ reason: "add sources first; the instructions are written from them" })
  const converted = yield* Effect.forEach(
    files.slice(0, 20),
    (file) =>
      sourceText(deps, file).pipe(
        Effect.map((result) => ({ path: sourcePath(item.directory, file), converted: result })),
      ),
    { concurrency: 4 },
  )
  const text = yield* generate(suggestion(item.name, digest(converted))).pipe(
    Effect.mapError(
      (error) => new JiphyeonjeonError({ reason: `the model could not write instructions: ${error.message}` }),
    ),
  )
  return text.replace(/^```[a-z]*\n?|\n?```$/g, "").trim()
})
