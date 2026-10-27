export * as SourceSearch from "./source-search.js"

import { Effect, Schema } from "effect"
import { Jiphyeonjeon } from "./jiphyeonjeon.js"

export const name = "source_search"

const DEFAULT_LIMIT = 40

export const Input = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1, { message: "Query must not be empty" })).annotate({
    description:
      "Words to look for, separated by spaces; a line matches by containing them as written. Lines with more of the words come first. Use the sources' own terms and short core words, and try other wordings before deciding something is not in the sources.",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))).annotate({
    description: `Maximum number of matching lines to return (default: ${DEFAULT_LIMIT})`,
  }),
})

export const Output = Schema.Struct({
  searched: Schema.Number,
  total: Schema.Number,
  files: Schema.Array(Schema.Struct({ file: Schema.String, matches: Schema.Number })),
  matches: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      location: Schema.optional(Schema.String),
      line: Schema.Number,
      text: Schema.String,
    }),
  ),
  skipped: Schema.Array(Schema.Struct({ file: Schema.String, reason: Schema.String })),
  partial: Schema.Array(Schema.Struct({ file: Schema.String, pages: Schema.Array(Schema.Number) })),
  unsearched: Schema.Number,
})

/** The link a source is cited with, so the answer can open it; its name loses brackets that would break the link. */
export const citation = (file: string) => {
  const display = (file.split("/").at(-1) ?? file).replace(/[[\]]/g, "").trim()
  return `[${display} · 위치](<${file}>)`
}

/** Matches grouped by source, each with the link to cite it, the place to put in the link, and the line to read. */
export function toModelContent(result: typeof Output.Type) {
  const counts = result.files.map((item) => `${item.file} ${item.matches}`).join(", ")
  const head =
    result.total === 0
      ? `No matches in ${result.searched} searched sources`
      : `Found ${result.total} matching lines in ${result.files.length} of ${result.searched} searched sources${result.total > result.matches.length ? `, showing ${result.matches.length}` : ""} (${counts}). Cite with the source's link, writing the place shown before "line" in place of 위치, or the line as N줄 when no place is shown.`
  const groups = Map.groupBy(result.matches, (match) => match.file)
  const body = [...groups].flatMap(([file, matches]) => [
    "",
    `${file} - cite as ${citation(file)}`,
    ...matches.map((match) => `  ${match.location ? `${match.location}, ` : ""}line ${match.line}: ${match.text}`),
  ])
  const skipped = result.skipped.map((item) => `- ${item.file}: ${item.reason}`)
  const partial = result.partial.map((item) => `- ${item.file}: pages ${item.pages.join(", ")}`)
  return [
    head,
    ...body,
    ...(skipped.length ? ["", "Not searched:", ...skipped] : []),
    ...(partial.length
      ? ["", "Pages without text, probably scanned images, so not searched; say they were not checked:", ...partial]
      : []),
    ...(result.unsearched ? ["", `${result.unsearched} more files were not searched; the first 1000 were.`] : []),
  ].join("\n")
}

/** The tool a 집현전's sessions use to find what its sources say. */
export function tool(deps: Jiphyeonjeon.Dependencies, directory: string) {
  return {
    name,
    options: { codemode: false },
    description: `Search the sources in this 집현전's ${Jiphyeonjeon.SOURCES} folder: text, Word, Excel, PowerPoint, Hangul (HWP, HWPX) and PDF documents, and recordings already transcribed. Returns matching lines with the source file, the page, slide, sheet or time to cite, and the line number to read with the read tool for context.`,
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type) =>
      Jiphyeonjeon.search(deps, directory, { query: input.query, limit: input.limit ?? DEFAULT_LIMIT }).pipe(
        Effect.map((output) => ({ output, content: toModelContent(output) })),
      ),
  }
}
