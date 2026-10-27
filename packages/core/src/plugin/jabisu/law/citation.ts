export * as LawCitation from "./citation.js"

// How Korean official writing cites a law: the name in 「」 and then the article, as in 「보조금 관리에 관한 법률」
// 제26조의2 제1항 제3호; after one, 같은 법 (시행령) 제N조 points back at it.

/** An article and, when given, its paragraph (항) and item (호). */
export interface Article {
  readonly article: number
  readonly branch?: number
  readonly paragraph?: number
  readonly item?: number
}

/** A citation found in a text: the name inside 「」 and the article it points to, as written. */
export interface Citation extends Article {
  readonly name: string
  readonly written: string
}

const ARTICLE = String.raw`제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?`

const ARTICLE_ONLY = new RegExp(`^\\s*${ARTICLE}\\s*$`)

// 「name」, optionally followed by a note such as (이하 "법"이라 한다) and an article; or 같은 법 with an article.
const CITATION = new RegExp(
  `「([^」]{2,100})」(?:\\s*\\([^)]{0,60}\\))?(?:\\s*${ARTICLE})?|같은\\s*법(\\s*시행령|\\s*시행규칙)?\\s*${ARTICLE}`,
  "g",
)

// What follows a citation belongs to the same law: another article, as in 제11조 및 제12조, or another paragraph or
// item of the same article, as in 제2항 및 제3항 or 제3호ㆍ제4호.
const CONTINUATION = new RegExp(
  `\\s*(?:및|와|과|또는|,|ㆍ|·)\\s*(?:${ARTICLE}|제\\s*(\\d+)\\s*항(?:\\s*제\\s*(\\d+)\\s*호)?|제\\s*(\\d+)\\s*호)`,
  "y",
)

const number = (value: string | undefined) => (value === undefined ? undefined : Number(value))

const parts = (values: readonly (string | undefined)[]): Article | undefined => {
  const article = number(values[0])

  if (article === undefined) return undefined
  const branch = number(values[1])
  const paragraph = number(values[2])
  const item = number(values[3])

  return {
    article,
    ...(branch ? { branch } : {}),
    ...(paragraph ? { paragraph } : {}),
    ...(item ? { item } : {}),
  }
}

/** An article as a person writes it, such as 제11조의2 or 11조의2 제2항; none when it is not one. */
export function article(text: string): Article | undefined {
  const match = ARTICLE_ONLY.exec(text.startsWith("제") ? text : `제${text.trim()}`)

  return match ? parts(match.slice(1)) : undefined
}

/** The six-digit article code the law API takes: 제11조의2 is 001102. */
export const code = (ref: Pick<Article, "article" | "branch">) =>
  `${String(ref.article).padStart(4, "0")}${String(ref.branch ?? 0).padStart(2, "0")}`

/** The article as official writing names it: 제11조의2 제2항 제3호. */
export function label(ref: Article) {
  return [
    `제${ref.article}조${ref.branch ? `의${ref.branch}` : ""}`,
    ...(ref.paragraph ? [`제${ref.paragraph}항`] : []),
    ...(ref.item ? [`제${ref.item}호`] : []),
  ].join(" ")
}

/** Names compare without spaces or the kinds of middle dot, as people write them either way. */
export const key = (name: string) => name.replace(/[\s·ㆍ・]/g, "")

const withoutDecree = (name: string) => name.replace(/\s*(시행령|시행규칙)$/, "")

/** Every article cited in a text, each once, in the order they appear. */
export function find(text: string): Citation[] {
  const found: Citation[] = []
  const seen = new Set<string>()
  // The law a bracketed name last named, which 같은 법 refers back to.
  let last: string | undefined

  for (const match of text.matchAll(CITATION)) {
    const bracketed = match[1]?.trim()
    const decree = match[6]?.trim()
    const name = bracketed ?? (last === undefined ? undefined : [withoutDecree(last), decree].filter(Boolean).join(" "))
    const ref = parts(bracketed === undefined ? match.slice(7, 11) : match.slice(2, 6))

    if (bracketed !== undefined) last = bracketed
    if (name === undefined || ref === undefined) continue
    const add = (article: Article, written: string) => {
      const id = `${key(name)}\0${label(article)}`

      if (seen.has(id)) return
      seen.add(id)
      found.push({ ...article, name, written })
    }

    add(ref, match[0].trim())
    let previous = ref

    CONTINUATION.lastIndex = (match.index ?? 0) + match[0].length
    for (let next = CONTINUATION.exec(text); next; next = CONTINUATION.exec(text)) {
      const paragraph = number(next[5])
      const item = number(next[6] ?? next[7])
      const article = { article: previous.article, ...(previous.branch ? { branch: previous.branch } : {}) }
      const following =
        parts(next.slice(1, 5)) ??
        (paragraph
          ? { ...article, paragraph, ...(item ? { item } : {}) }
          : { ...article, ...(previous.paragraph ? { paragraph: previous.paragraph } : {}), ...(item ? { item } : {}) })

      add(following, next[0].trim())
      previous = following
    }
  }

  return found
}
