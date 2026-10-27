export * as WorkSearch from "./search-tool.js"

import type { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import path from "path"
import { WorkIndex } from "./index.js"

export const name = "work_search"

const DEFAULT_LIMIT = 20

const DATE = /^\d{4}-\d{2}-\d{2}$/

const ROLES = ["jabisu", "received", "saved"] as const

// How each kind of folder is named to the model.
const ROLE_NAMES = {
  jabisu: "자비수 work folder: the work profile and reference documents such as the duty assignment table",
  received: "received files: where files from messengers and downloads land",
  saved: "saved work: where the user files their work documents",
} satisfies Record<(typeof ROLES)[number], string>

export const Input = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description:
      "Words to look for, separated by spaces; every word must appear as written, inside a name or the text. Use short core words: 사무분장 finds 사무분장표 and 바이오산업팀 사무분장.hwp, but 사무분장표 misses the latter. Leave it out to list the newest files, e.g. what arrived this week.",
  }),
  where: Schema.optional(Schema.Literals(["all", "name", "content"])).annotate({
    description: "Search file names and folders, document text, or both (default: all).",
  }),
  place: Schema.optional(Schema.Literals(ROLES)).annotate({
    description:
      "Only one kind of folder: jabisu (자비수's work folder, with the work profile and reference documents), received (where received files land: downloads, messenger folders), saved (where the user files their work).",
  }),
  folder: Schema.optional(Schema.String).annotate({
    description: "Only this indexed folder, or a folder inside one (absolute path).",
  }),
  extensions: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Only these file types, e.g. ["hwp", "hwpx", "pdf"].',
  }),
  since: Schema.optional(Schema.String.check(Schema.isPattern(DATE))).annotate({
    description: "Only files changed on or after this local date, YYYY-MM-DD.",
  }),
  until: Schema.optional(Schema.String.check(Schema.isPattern(DATE))).annotate({
    description: "Only files changed on or before this local date, YYYY-MM-DD.",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))).annotate({
    description: `Maximum number of files (default: ${DEFAULT_LIMIT}).`,
  }),
})

export const Output = Schema.Struct({
  available: Schema.Boolean,
  folders: Schema.Array(
    Schema.Struct({
      folder: Schema.String,
      role: Schema.Literals(ROLES),
      files: Schema.Number,
      documents: Schema.Number,
      pending: Schema.Number,
    }),
  ),
  hits: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      modified: Schema.String,
      size: Schema.Number,
      match: Schema.Literals(["name", "content", "recent"]),
      snippet: Schema.optional(Schema.String),
    }),
  ),
})

const day = (value: string, end: boolean) => {
  const [year, month, date] = value.split("-").map(Number)

  return new Date(year!, month! - 1, date!, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0).getTime()
}

const localDate = (ms: number) => {
  const date = new Date(ms)
  const two = (value: number) => String(value).padStart(2, "0")

  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function toModelContent(result: typeof Output.Type) {
  if (!result.available)
    return "No work folders are indexed yet. Ask the user to add folders in Settings → Preferences (환경 설정) → 업무 비서; until then, use the other file tools."

  const coverage = result.folders
    .map(
      (item) =>
        `${item.folder} (${ROLE_NAMES[item.role]}): ${item.files} files, ${item.documents} documents${item.pending ? ` (${item.pending} documents' text not indexed yet, found by name only)` : ""}`,
    )
    .join("\n")
  const hits = result.hits.flatMap((hit) => [
    `${hit.modified} · ${size(hit.size)} · ${hit.match} · ${hit.path}`,
    ...(hit.snippet ? [`  ${hit.snippet.replace(/\s+/g, " ").trim()}`] : []),
  ])

  return [
    hits.length ? `${hits.length} files (newest or best first):` : "No matching files. Try fewer or shorter words.",
    ...hits,
    "",
    "Indexed folders:",
    coverage,
    "",
    "Read a file with the read tool before relying on it.",
  ].join("\n")
}

/** The tool every 자비수 session uses to find files in the user's chosen work folders. */
export function tool(global: Pick<Global.Interface, "data" | "config">) {
  return {
    name,
    options: { codemode: false },
    description:
      "Find files in the folders 자비수 indexes for the user's work — its own work folder, the folders where received files land (downloads, messenger folders) and the folders where the user files their work: by words in file and folder names or in document text (Hangul, Word, Excel, PowerPoint, PDF, text), by type and by date, or the newest files. Fast: it searches a local index, not the disk.",
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type) =>
      Effect.sync(() => {
        const db = WorkIndex.reader(global)

        if (!db) return { available: false, folders: [], hits: [] } satisfies typeof Output.Type

        try {
          const folders = WorkIndex.stats(db)
          const hits = WorkIndex.search(db, {
            words: (input.query ?? "").split(/\s+/).filter(Boolean),
            where: input.where ?? "all",
            ...(input.place ? { role: input.place } : {}),
            ...(input.folder ? { folder: path.resolve(input.folder) } : {}),
            ...(input.extensions ? { extensions: input.extensions } : {}),
            ...(input.since ? { since: day(input.since, false) } : {}),
            ...(input.until ? { until: day(input.until, true) } : {}),
            limit: input.limit ?? DEFAULT_LIMIT,
          })

          return {
            available: folders.length > 0,
            folders: folders.map(({ ready: _ready, ...rest }) => rest),
            hits: hits.map((hit) => ({
              path: hit.path,
              modified: localDate(hit.modified),
              size: hit.size,
              match: hit.match,
              ...(hit.snippet ? { snippet: hit.snippet } : {}),
            })),
          } satisfies typeof Output.Type
        } finally {
          db.close()
        }
      }).pipe(Effect.map((output) => ({ output, content: toModelContent(output) }))),
  }
}
