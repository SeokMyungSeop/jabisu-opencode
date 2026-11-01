export * as LawAmendment from "./amendment.js"

import type { LawApi } from "./api.js"

// A 신·구조문대비표: the current text of the articles an amendment changes, beside the amendment, laid out as 법제처's
// 법제업무편람 has it. The current text is on the left with the changed words underlined; the amendment is on the right
// with the same words underlined and every unchanged character written as a dash; paragraphs and items that stay the
// same fold into "① ∼ ③ (생  략)" on the left and "① ∼ ③ (현행과 같음)" on the right; <신  설> and <삭  제> mark what
// is added and removed. Both sides are read by one parser so that they line up unit by unit, and units pair by their
// numbers, as the official tables pair them even when a unit inserted in the middle shifts the ones after it.

/** A piece of a line, underlined where it changed. */
export interface Segment {
  readonly text: string
  readonly underline: boolean
}

export type Line = readonly Segment[]

/** One row of the table: the current text and the amendment facing it. */
export interface Row {
  readonly before: readonly Line[]
  readonly after: readonly Line[]
}

export type Level = "paragraph" | "item" | "subitem" | "point" | "subpoint"

const DEPTH = { paragraph: 1, item: 2, subitem: 3, point: 4, subpoint: 5 } satisfies Record<Level, number>

/** A paragraph (①), item (1.), subitem (가.) or point (1), 가)) of an article, with the units under it. */
export interface Unit {
  readonly level: Level
  readonly label: string
  /** The space the text puts after the label; old laws write ①문화체육관광부장관은 with none. */
  readonly gap: string
  readonly body: string
  readonly units: readonly Unit[]
  /** A placeholder for the current units from this label to this one, as ② ∼ ⑤ (현행과 같음) is. */
  readonly same?: string
}

/** An article: its number (제5조의2), its title with the brackets, the text before any unit, and its units. */
export interface Article {
  readonly number: string
  readonly title: string
  readonly lead: string
  readonly units: readonly Unit[]
}

export const BEFORE_SAME = "(생  략)"
export const AFTER_SAME = "(현행과 같음)"
export const ADDED = "<신  설>"
export const REMOVED = "<삭  제>"

const POINTS = "가나다라마바사아자차카타파하"

const LABELS: readonly (readonly [Level, RegExp])[] = [
  ["paragraph", /^([①-⑳㉑-㉟㊱-㊿])(\s*)/],
  ["item", /^(\d{1,3}(?:의\d{1,2})?\.)(?=\s|$)(\s*)/],
  ["subitem", new RegExp(`^([${POINTS}](?:의\\d{1,2})?\\.)(?=\\s|$)(\\s*)`)],
  ["point", /^(\d{1,3}\))(\s+)/],
  ["subpoint", new RegExp(`^([${POINTS}]\\))(\\s+)`)],
]

const LABEL = `[①-⑳㉑-㉟㊱-㊿]|\\d{1,3}(?:의\\d{1,2})?\\.|[${POINTS}](?:의\\d{1,2})?\\.|\\d{1,3}\\)|[${POINTS}]\\)`
const SAME = "\\((?:현행과\\s*같음|생\\s*략)\\)"
const PLACEHOLDER = new RegExp(`^(${LABEL})(?:\\s*[·ㆍ∼~～]\\s*(${LABEL}))?\\s*${SAME}$`)
const SAME_ALONE = new RegExp(`^${SAME}$`)

// Only a number followed by a space, a bracket or nothing heads an article; 제3조에 따른 starts a sentence.
const HEADING = /^(제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?)(?=[\s(]|$)\s*(\((?:[^()]|\([^()]*\))*\))?\s*/

/** The article number as one writes it, without spaces: 제5조의2. */
export const numberOf = (text: string) => HEADING.exec(text.trim())?.[1]?.replace(/\s+/g, "")

// A table leaves out the history notes the official text carries: <개정 2013.3.23>, [전문개정 2008.3.21] and the like.
const withoutNotes = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line))
    .map((line) =>
      line
        .replace(/<(?:개정|신설|전문개정|본조신설|제목개정|타법개정|종전)[^<>]{0,300}>/g, "")
        .replace(/<\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?(?:,\s?\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?)*>/g, "")
        .replace(/\[(?:전문개정|본조신설|제목개정|본조제목개정|종전|시행일)[^\]]{0,300}\]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)

const labelOf = (line: string) => {
  for (const [level, pattern] of LABELS) {
    const match = pattern.exec(line)

    if (match) return { level, label: match[1]!, gap: match[2] ? " " : "", rest: line.slice(match[0].length).trim() }
  }

  return undefined
}

const join = (text: string, line: string) => (text ? `${text} ${line}` : line)

/**
 * An article from its text, one unit to a line; a line without a label continues the one before. The heading may
 * share its line with the first unit, as 제2조(정의) ① … does.
 */
export function parse(text: string): Article {
  const lines = withoutNotes(text)
  const heading = HEADING.exec(lines[0] ?? "")
  const article = { number: "", title: "", lead: "", units: [] as Unit[] }

  if (heading) {
    article.number = heading[1]!.replace(/\s+/g, "")
    article.title = heading[2] ?? ""
    lines[0] = lines[0]!.slice(heading[0].length)
    if (!lines[0]) lines.shift()
  }
  type Draft = { level: Level; label: string; gap: string; body: string; units: Draft[]; same?: string }
  const top: Draft[] = []
  const open: Draft[] = []

  for (const line of lines) {
    const holder = PLACEHOLDER.exec(line)
    const found = holder ? labelOf(`${holder[1]} `) : labelOf(line)
    const last = open.at(-1)

    if (!found) {
      if (last) last.body = join(last.body, line)
      else article.lead = join(article.lead, line)
      continue
    }
    const unit: Draft = {
      level: found.level,
      label: found.label,
      gap: found.gap,
      body: holder ? "" : found.rest,
      units: [],
      ...(holder ? { same: holder[2] ?? holder[1]! } : {}),
    }

    while (open.length && DEPTH[open.at(-1)!.level] >= DEPTH[unit.level]) open.pop()
    ;(open.at(-1)?.units ?? top).push(unit)
    open.push(unit)
  }

  return { ...article, units: top }
}

/**
 * An article law.go.kr gave, one unit to a line as `parse` reads it. A law's article comes with its items apart from
 * the paragraph's words; an ordinance's or rule's comes as one text whose paragraphs hold their items.
 */
export function text(article: Pick<LawApi.ArticleText, "heading" | "paragraphs">) {
  const lines = [article.heading]

  for (const paragraph of article.paragraphs) {
    const first = paragraph.items[0]
    const at = first ? paragraph.text.indexOf(first.text) : -1

    lines.push(at >= 0 ? paragraph.text.slice(0, at) : paragraph.text, ...paragraph.items.map((item) => item.text))
  }

  return lines
    .flatMap((line) => line.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

/** Whether the text is the whole article deleted, as 제5조 삭제 writes it. */
const isDeleted = (article: Article) => /^삭제\.?$/.test(article.lead) && article.units.length === 0

/** The amendment with its placeholders replaced by the current units they stand for; those it cannot find, in `missing`. */
export function fill(proposal: Article, current: Article, missing: string[]): Article {
  return {
    ...proposal,
    lead: SAME_ALONE.test(proposal.lead) ? current.lead : proposal.lead,
    units: fillUnits(proposal.units, current.units, missing),
  }
}

function fillUnits(units: readonly Unit[], current: readonly Unit[], missing: string[]): Unit[] {
  return units.flatMap((unit) => {
    const at = (label: string) => current.findIndex((item) => item.level === unit.level && item.label === label)

    if (unit.same !== undefined) {
      const from = at(unit.label)
      const to = at(unit.same)

      if (from >= 0 && to >= from) return current.slice(from, to + 1)
      missing.push(unit.same === unit.label ? unit.label : `${unit.label} ∼ ${unit.same}`)

      return []
    }

    return [{ ...unit, units: fillUnits(unit.units, current[at(unit.label)]?.units ?? [], missing) }]
  })
}

/** Text compared as the same despite spacing, middle-dot variants and curly quotes. */
const normal = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/[·‧•・]/g, "ㆍ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()

/** A current unit and the amendment's unit with the same number, or either alone, with their units paired too. */
interface Pair {
  readonly before?: Unit
  readonly after?: Unit
  readonly pairs: readonly Pair[]
}

const keyOf = (unit: Unit) => `${unit.level}:${unit.label}`

/** The units paired by number in order: the longest run of numbers both have, the rest added or removed. */
function align(before: readonly Unit[], after: readonly Unit[]): Pair[] {
  const longest = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))

  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      longest[i]![j] =
        keyOf(before[i]!) === keyOf(after[j]!)
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!)
  const pairs: Pair[] = []
  let i = 0
  let j = 0

  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && keyOf(before[i]!) === keyOf(after[j]!)) {
      pairs.push({ before: before[i], after: after[j], pairs: align(before[i]!.units, after[j]!.units) })
      i++
      j++
    } else if (i < before.length && (j >= after.length || longest[i + 1]![j]! >= longest[i]![j + 1]!)) {
      pairs.push({ before: before[i], pairs: [] })
      i++
    } else {
      pairs.push({ after: after[j], pairs: [] })
      j++
    }
  }

  return pairs
}

const isSame = (pair: Pair): boolean =>
  !!pair.before &&
  !!pair.after &&
  pair.before.label === pair.after.label &&
  normal(pair.before.body) === normal(pair.after.body) &&
  pair.pairs.every(isSame)

/** A unit the amendment keeps by its number but deletes, as ③ 삭제 writes it. */
const deletedInPlace = (pair: Pair) =>
  !!pair.before && !!pair.after && /^삭제\.?$/.test(pair.after.body) && !/^삭제\.?$/.test(pair.before.body)

const plain = (text: string): Segment => ({ text, underline: false })
const under = (text: string): Segment => ({ text, underline: true })

// Words with the spaces after them, also cut before an opening bracket or quote; joined, they are the text again.
const tokensOf = (text: string) => text.match(/[^\s([「“]+\s*|[([「“][^\s([「“]*\s*|\s+/g) ?? []

interface Op {
  readonly same: boolean
  readonly before: string[]
  readonly after: string[]
}

// Longer texts than any paragraph compare only by their common start and end.
const MAX_CELLS = 1_000_000

function operations(before: readonly string[], after: readonly string[]): Op[] {
  const key = (token: string) => normal(token)
  const n = before.length
  const m = after.length

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    let start = 0
    let end = 0

    while (start < Math.min(n, m) && key(before[start]!) === key(after[start]!)) start++
    while (end < Math.min(n, m) - start && key(before[n - 1 - end]!) === key(after[m - 1 - end]!)) end++

    return [
      { same: true, before: before.slice(0, start), after: after.slice(0, start) },
      { same: false, before: before.slice(start, n - end), after: after.slice(start, m - end) },
      { same: true, before: before.slice(n - end), after: after.slice(m - end) },
    ].filter((op) => op.before.length || op.after.length)
  }
  const longest = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))

  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      longest[i]![j] =
        key(before[i]!) === key(after[j]!)
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!)
  const ops: Op[] = []
  const push = (same: boolean, from?: string, to?: string) => {
    const last = ops.at(-1)
    const op = last && last.same === same ? last : { same, before: [], after: [] }

    if (op !== last) ops.push(op)
    if (from !== undefined) op.before.push(from)
    if (to !== undefined) op.after.push(to)
  }
  let i = 0
  let j = 0

  while (i < n || j < m) {
    if (i < n && j < m && key(before[i]!) === key(after[j]!)) push(true, before[i++], after[j++])
    else if (j < m && (i >= n || longest[i]![j + 1]! >= longest[i + 1]![j]!)) push(false, undefined, after[j++])
    else push(false, before[i++])
  }

  return ops
}

// The underline runs by whole words: an insertion or a deletion takes the word before it (or after it) on both sides,
// as an amendment writes 「A」를 「A, B」로; two changes with one unchanged word between them become one.
function shape(ops: Op[]) {
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!

    if (op.same || (op.before.length && op.after.length)) continue
    const previous = ops[k - 1]
    const next = ops[k + 1]

    if (previous?.same && previous.before.length) {
      op.before.unshift(previous.before.pop()!)
      op.after.unshift(previous.after.pop()!)
    } else if (next?.same && next.before.length) {
      op.before.push(next.before.shift()!)
      op.after.push(next.after.shift()!)
    }
  }
  const merged: Op[] = []

  for (const op of ops.filter((item) => item.before.length || item.after.length)) {
    const gap = merged.at(-1)
    const changed = merged.at(-2)

    if (!op.same && gap?.same && gap.before.length <= 1 && changed && !changed.same) {
      merged.pop()
      changed.before.push(...gap.before, ...op.before)
      changed.after.push(...gap.after, ...op.after)
      continue
    }
    merged.push(op)
  }

  return merged
}

// Particles that close a changed chunk on both sides stay outside the underline: <u>공사완료도서</u>를.
const PARTICLES = [
  "으로써",
  "으로서",
  "에서는",
  "로써",
  "로서",
  "에서",
  "에게",
  "에는",
  "으로",
  "부터",
  "까지",
  "이나",
  "로",
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
  "의",
  "에",
  "와",
  "과",
  "도",
  "만",
]

function particle(before: string, after: string) {
  let from = before.trimEnd()
  let to = after.trimEnd()
  let tail = before.slice(from.length)
  const stop = /[,.]+$/.exec(from)?.[0]

  if (stop && to.endsWith(stop) && from.length > stop.length && to.length > stop.length) {
    from = from.slice(0, -stop.length)
    to = to.slice(0, -stop.length)
    tail = stop + tail
  }
  for (const word of PARTICLES) {
    if (from.length <= word.length || to.length <= word.length || !from.endsWith(word) || !to.endsWith(word)) continue
    if (/[\d\s]/.test(from.at(-word.length - 1)!) || /[\d\s]/.test(to.at(-word.length - 1)!)) continue

    return { before: from.slice(0, -word.length), after: to.slice(0, -word.length), tail: word + tail }
  }

  return { before: from, after: to, tail }
}

const add = (line: Segment[], text: string, underline: boolean) => {
  if (!text) return
  const last = line.at(-1)

  if (last && last.underline === underline) line[line.length - 1] = { text: last.text + text, underline }
  else line.push({ text, underline })
}

/** The line with the spaces at either end of an underline moved outside it. */
function trimmed(line: readonly Segment[]) {
  const out: Segment[] = []

  for (const segment of line) {
    if (!segment.underline) {
      add(out, segment.text, false)
      continue
    }
    const core = segment.text.trim()

    if (!core) {
      add(out, segment.text, false)
      continue
    }
    const start = segment.text.indexOf(core)

    add(out, segment.text.slice(0, start), false)
    add(out, core, true)
    add(out, segment.text.slice(start + core.length), false)
  }

  return out
}

const visible = (text: string) => text.replace(/\s/g, "").length

// When less than this share of the text stays, the unit was rewritten, and stray common words such as 또는 would only
// break up its underline.
const REWRITTEN = 0.3

/** The changed words of one text against another, underlined on both sides. */
export function diff(before: string, after: string): { before: Line; after: Line; whole: boolean } {
  const ops = shape(operations(tokensOf(before), tokensOf(after)))
  const kept = ops.filter((op) => op.same).reduce((sum, op) => sum + visible(op.before.join("")), 0)

  if (kept < REWRITTEN * Math.max(visible(before), visible(after)))
    return { before: trimmed([under(before)]), after: trimmed([under(after)]), whole: true }
  const left: Segment[] = []
  const right: Segment[] = []

  for (const op of ops) {
    if (op.same) {
      add(left, op.before.join(""), false)
      add(right, op.after.join(""), false)
      continue
    }
    const cut = particle(op.before.join(""), op.after.join(""))

    add(left, cut.before, true)
    add(right, cut.after, true)
    add(left, cut.tail, false)
    add(right, cut.tail, false)
  }
  const whole = [...left, ...right].every((segment) => segment.underline || !segment.text.trim())

  return { before: trimmed(left), after: trimmed(right), whole }
}

/**
 * The amendment's unchanged text as dashes, one for each character, keeping the period that ends a sentence and the
 * spaces at either end; `previous` is the character before it, for a period left alone after an underlined word.
 */
export function dashes(text: string, previous = "") {
  const core = text.trim()

  if (!core) return text
  const start = text.indexOf(core)
  let out = ""

  for (let k = 0; k < core.length; k++) {
    const before = k > 0 ? core[k - 1]! : (text[start - 1] ?? previous)
    const ends = core[k] === "." && (k === core.length - 1 || /\s/.test(core[k + 1]!)) && /[가-힣)」\]”]/.test(before)

    out += ends ? "." : out.endsWith(".") && /\s/.test(core[k]!) ? " " : "-"
  }

  return text.slice(0, start) + out + text.slice(start + core.length)
}

const dashed = (line: Line): Line =>
  line.map((segment, index) =>
    segment.underline ? segment : plain(dashes(segment.text, line[index - 1]?.text.slice(-1) ?? "")),
  )

const TAIL = /^([\s\S]*?\.)\s(다만,|이 경우)\s([\s\S]*)$/

/** A text with the 단서 (다만, …) or 후단 (이 경우 …) sentence that ends it set apart. */
const split = (text: string) => {
  const match = TAIL.exec(text)

  return match
    ? { main: match[1]!, tail: `${match[2]} ${match[3]}`, kind: match[2] === "다만," ? "단서" : "후단" }
    : { main: text, tail: "", kind: undefined }
}

/** The current and amended text of a unit, the amendment's unchanged words as dashes. */
function compare(before: string, after: string) {
  if (normal(before) === normal(after))
    return { before: [plain(before)] as Line, after: [plain(dashes(after))] as Line, whole: false }
  const old = split(before)
  const next = split(after)

  // A sentence added to or dropped from the end shows as <단서 신설> or <단서 삭제> when the rest only changes in part.
  if (!old.kind && next.kind) {
    const part = diff(before, next.main)

    if (!part.whole)
      return {
        before: [...part.before, plain(" "), under(`<${next.kind} 신설>`)],
        after: [...dashed(part.after), plain(" "), under(next.tail)],
        whole: false,
      }
  }
  if (old.kind && !next.kind) {
    const part = diff(old.main, after)

    if (!part.whole)
      return {
        before: [...part.before, plain(" "), under(old.tail)],
        after: [...dashed(part.after), plain(" "), under(`<${old.kind} 삭제>`)],
        whole: false,
      }
  }
  const part = diff(before, after)

  return { before: part.before, after: dashed(part.after), whole: part.whole }
}

/** A unit and the units under it as text lines, each with its label. */
const unitLines = (unit: Unit): string[] => [
  unit.body ? `${unit.label}${unit.gap}${unit.body}` : unit.label,
  ...unit.units.flatMap(unitLines),
]

/** A whole article as text lines, its first unit on the heading's line. */
const articleLines = (article: Article) => {
  const head = `${article.number}${article.title}`
  const body = [...(article.lead ? [article.lead] : []), ...article.units.flatMap(unitLines)]

  return body.length ? [`${head} ${body[0]}`, ...body.slice(1)] : [head]
}

const underAll = (lines: readonly string[]): Line[] => lines.map((line) => [under(line)])

/** ①·② for two labels, ① ∼ ⑤ for more. */
const labels = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : items.length === 2
      ? `${items[0]}·${items[1]}`
      : `${items[0]} ∼ ${items.at(-1)}`

const labelled = (unit: Unit, line: Line, changed: boolean): Line => [
  changed ? under(unit.label) : plain(unit.label),
  ...(unit.gap ? [plain(unit.gap)] : []),
  ...line,
]

function changedRows(pair: Pair, rows: Row[]) {
  const before = pair.before!
  const after = pair.after!
  const text = compare(before.body, after.body)

  // A unit rewritten so that it gains or loses its items is replaced whole, its items in the same cell.
  if (text.whole && (before.units.length === 0) !== (after.units.length === 0)) {
    rows.push({ before: underAll(unitLines(before)), after: underAll(unitLines(after)) })
    return
  }
  const relabelled = text.whole || before.label !== after.label

  rows.push({ before: [labelled(before, text.before, relabelled)], after: [labelled(after, text.after, relabelled)] })
  pairRows(pair.pairs, rows)
}

function pairRows(pairs: readonly Pair[], rows: Row[]) {
  for (let k = 0; k < pairs.length; ) {
    const pair = pairs[k]!

    if (isSame(pair)) {
      const run: Pair[] = []

      while (k < pairs.length && isSame(pairs[k]!)) run.push(pairs[k++]!)
      const names = labels(run.map((item) => item.before!.label))

      rows.push({ before: [[plain(`${names} ${BEFORE_SAME}`)]], after: [[plain(`${names} ${AFTER_SAME}`)]] })
      continue
    }
    k++
    if (!pair.before) rows.push({ before: [[under(ADDED)]], after: underAll(unitLines(pair.after!)) })
    else if (!pair.after) rows.push({ before: underAll(unitLines(pair.before)), after: [[under(REMOVED)]] })
    else if (deletedInPlace(pair))
      rows.push({
        before: underAll(unitLines(pair.before)),
        after: [[plain(`${pair.after.label}${pair.after.gap || " "}`), under(pair.after.body)]],
      })
    else changedRows(pair, rows)
  }
}

/** Current units the amendment leaves out without deleting them, which the table then shows as removed. */
const dropped = (pairs: readonly Pair[], prefix = ""): string[] =>
  pairs.flatMap((pair) =>
    !pair.after
      ? [`${prefix}${pair.before!.label}`]
      : pair.before
        ? dropped(pair.pairs, `${prefix}${pair.before.label} `)
        : [],
  )

// An article whose text only had a body and is now split into paragraphs, or the other way round, is replaced whole.
const form = (article: Article) => (article.lead ? "lead" : `units:${article.units[0]?.level ?? ""}`)

/**
 * The rows of one article: added when there is no current article, deleted when the amendment says 제N조 삭제, and none
 * when nothing changed. What the reader should check goes to `notes`.
 */
export function rows(current: Article | undefined, proposal: Article, notes: string[]): Row[] | undefined {
  if (!current) return [{ before: [[under(ADDED)]], after: underAll(articleLines(proposal)) }]
  const missing: string[] = []
  const next = fill(proposal, current, missing)

  if (missing.length)
    notes.push(`${next.number}: (현행과 같음)으로 적은 ${missing.join(", ")}이(가) 현행에 없어 뺐습니다`)
  if (isDeleted(next) && !isDeleted(current))
    return [{ before: underAll(articleLines(current)), after: [[plain(`${next.number} `), under("삭제")]] }]
  const titleChanged = normal(current.title) !== normal(next.title)
  const head = (article: Article): Line => [
    plain(article.number),
    ...(article.title ? [titleChanged ? under(article.title) : plain(article.title)] : []),
  ]

  if (form(current) !== form(next))
    return [{ before: underAll(articleLines(current)), after: underAll(articleLines(next)) }]
  const pairs = align(current.units, next.units)
  const gone = dropped(pairs)

  if (gone.length)
    notes.push(
      `${next.number}: 개정안에 없는 ${gone.join(", ")}을(를) <삭  제>로 적었습니다. 그대로 두는 것이면 개정안에 "② ∼ ⑤ (현행과 같음)"처럼 적으세요`,
    )
  const leadSame = normal(current.lead) === normal(next.lead)

  if (leadSame && pairs.every(isSame) && !titleChanged) return undefined
  if (leadSame && pairs.length === 0)
    return [
      { before: [[...head(current), plain(` ${BEFORE_SAME}`)]], after: [[...head(next), plain(` ${AFTER_SAME}`)]] },
    ]
  const out: Row[] = []

  if (current.lead || next.lead) {
    const text = compare(current.lead, next.lead)

    out.push({ before: [text.before], after: [text.after] })
  }
  pairRows(pairs, out)
  const first = out[0]!

  out[0] = {
    before: [[...head(current), plain(" "), ...first.before[0]!], ...first.before.slice(1)],
    after: [[...head(next), plain(" "), ...first.after[0]!], ...first.after.slice(1)],
  }

  return out
}

/** The name of the draft: 일부개정법률안 for a law, 일부개정령안 for a decree or ministry rule, and so on. */
export function title(name: string, local: boolean) {
  if (/조례$/.test(name)) return `${name} 일부개정조례안`
  if (local && /규칙$/.test(name)) return `${name} 일부개정규칙안`
  if (/(령|시행규칙)$/.test(name)) return `${name} 일부개정령안`
  if (/법(률)?$/.test(name)) return `${name} 일부개정법률안`

  return `${name} 일부개정안`
}

const PUNCTUATION = /[\p{P}\p{S}]/u

const OPENING: Readonly<Record<string, string>> = { ")": "(", "]": "[", "」": "「", "”": "“" }

// CommonMark only reads ** as bold when the side facing the text is not punctuation next to a letter, as
// 제65조**(승무정원)** would be; such punctuation moves outside the bold.
function bold(text: string, start: number, end: number) {
  const opens = (at: number) => !PUNCTUATION.test(text[at]!) || at === 0 || /[\s\p{P}\p{S}]/u.test(text[at - 1]!)
  const closes = (at: number) =>
    !PUNCTUATION.test(text[at - 1]!) || at === text.length || /[\s\p{P}\p{S}]/u.test(text[at]!)

  while (start < end && !opens(start)) start++
  while (end > start && !closes(end)) end--
  // A closing bracket whose opening one stayed outside goes outside too: (**승무정원**), not (**승무정원)**.
  const count = (mark: string) => [...text.slice(start, end)].filter((character) => character === mark).length

  while (
    end > start &&
    OPENING[text[end - 1]!] !== undefined &&
    count(OPENING[text[end - 1]!]!) < count(text[end - 1]!)
  )
    end--

  return [start, end] as const
}

const escape = (text: string) => text.replace(/([|*\\])/g, "\\$1")

/** A line in Markdown, its underlined words in bold; chat screens do not draw underlines. */
export function markdownLine(line: Line) {
  const text = line.map((segment) => segment.text).join("")
  let out = ""
  let at = 0
  let position = 0

  for (const segment of line) {
    const end = at + segment.text.length

    if (segment.underline && segment.text.trim()) {
      const [from, to] = bold(text, at, end)

      if (from < to) {
        out += `${escape(text.slice(position, from))}**${escape(text.slice(from, to))}**`
        position = to
      }
    }
    at = end
  }

  return out + escape(text.slice(position))
}

/** The table in Markdown, a line break in a cell as <br>. */
export function markdown(heading: string, articles: readonly (readonly Row[])[]) {
  const cell = (lines: readonly Line[]) => lines.map(markdownLine).join("<br>")

  return [
    `### ${heading}`,
    "",
    "| 현      행 | 개   정   안 |",
    "| --- | --- |",
    ...articles.flat().map((row) => `| ${cell(row.before)} | ${cell(row.after)} |`),
  ].join("\n")
}
