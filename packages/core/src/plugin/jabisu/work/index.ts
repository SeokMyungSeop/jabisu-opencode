export * as WorkIndex from "./index.js"

import { openWorkDatabase } from "#jabisu-work-database"
import { DocumentText } from "@opencode/util/document-text"
import type { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Effect } from "effect"
import type { Stats } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "path"
import { DocumentExtract } from "../document-extract.js"
import type { Value, WorkDatabase } from "./database-types.js"
import type { WorkSettings } from "./settings.js"

// 자비수's index of the folders the user chose, in the manner of Everything without its administrator rights: a
// fast scan keeps every file's name, size and date in SQLite, a watcher and a rescan at start catch changes, and
// documents' text fills an FTS5 trigram index in the background so Korean words match without a dictionary.
// The indexer is the only writer; search opens the file read-only.

export const VERSION = 2

/** Extensions whose text is indexed. */
export const DOCUMENTS = new Set(["hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ods", "ppt", "pptx", "pdf", "txt", "md", "csv"])

// Text past this length is not indexed; a longer document is still found by its start and its name.
const MAX_TEXT = 500_000

// Folders no one keeps work in, and lock or system files.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", "filmcraft previews"])
const skippedName = (name: string) =>
  name.startsWith("~$") || name.startsWith(".") || name === "Thumbs.db" || name === "desktop.ini"

// One index per settings file: a development copy or a test with its own config never writes the installed app's index.
export const file = (global: Pick<Global.Interface, "data" | "config">) =>
  path.join(global.data, "jabisu", "work", `index-${Hash.fast(path.resolve(global.config).toLowerCase())}.db`)

/** `none`: not a document; `pending`: its text is not read yet; `ready`: indexed; else why it has no text. */
export type TextState = "none" | "pending" | "ready" | "unsupported" | "unreadable" | "too-large"

interface Row {
  readonly id: number
  readonly path: string
  readonly size: number
  readonly mtime: number
}

export function migrate(db: WorkDatabase) {
  db.run("create table if not exists meta (key text primary key, value text not null)")
  const version = db.get<{ value: string }>("select value from meta where key = 'version'")?.value

  if (version === String(VERSION)) return
  db.transaction(() => {
    db.run("drop table if exists roots")
    db.run("drop table if exists files")
    db.run("drop table if exists texts")
    db.run("create table roots (folder text primary key, role text not null)")
    db.run(
      `create table files (
        id integer primary key,
        path text not null unique,
        folder text not null,
        name text not null,
        ext text not null,
        size integer not null,
        mtime integer not null,
        text_state text not null,
        text_reason text
      )`,
    )
    db.run("create index files_folder on files(folder)")
    db.run("create index files_mtime on files(mtime)")
    db.run("create index files_state on files(text_state)")
    db.run("create virtual table texts using fts5(body, tokenize = 'trigram')")
    db.run("insert or replace into meta (key, value) values ('version', ?)", String(VERSION))
  })
}

const extension = (name: string) => path.extname(name).slice(1).toLowerCase()

const insideSkipped = (folder: string, directory: string) =>
  path
    .relative(folder, directory)
    .split(path.sep)
    .some((part) => SKIPPED_DIRECTORIES.has(part.toLowerCase()))

const upsert = (db: WorkDatabase, folder: string, filepath: string, info: Stats, known: Row | undefined) => {
  const name = path.basename(filepath)
  const ext = extension(name)
  const state: TextState = DOCUMENTS.has(ext) ? "pending" : "none"

  if (known) {
    db.run(
      "update files set size = ?, mtime = ?, text_state = ?, text_reason = null where id = ?",
      info.size,
      Math.round(info.mtimeMs),
      state,
      known.id,
    )
    db.run("delete from texts where rowid = ?", known.id)

    return
  }

  db.run(
    "insert into files (path, folder, name, ext, size, mtime, text_state) values (?, ?, ?, ?, ?, ?, ?)",
    filepath,
    folder,
    name,
    ext,
    info.size,
    Math.round(info.mtimeMs),
    state,
  )
}

const removeUnder = (db: WorkDatabase, target: string) => {
  const prefix = `${target}${path.sep}`
  const ids = db.all<{ id: number }>(
    "select id from files where path = ? or substr(path, 1, length(?)) = ?",
    target,
    prefix,
    prefix,
  )

  for (const { id } of ids) {
    db.run("delete from texts where rowid = ?", id)
    db.run("delete from files where id = ?", id)
  }

  return ids.length
}

// Reading dates and sizes is the slow part of a scan, so it runs this many at a time.
const STAT_CONCURRENCY = 64

/**
 * Brings the index of `root`, which is `folder` or a folder inside it, in line with the disk: new and changed files
 * are stored, and their text is read again later; files no longer there are dropped.
 */
export const scan = Effect.fn("WorkIndex.scan")(function* (db: WorkDatabase, folder: string, root: string = folder) {
  const entries = yield* Effect.promise(() =>
    readdir(root, { recursive: true, withFileTypes: true }).catch(() => undefined),
  )

  if (!entries) return { files: 0, changed: 0, removed: root === folder ? removeUnder(db, folder) : 0 }

  const found = entries
    .filter((entry) => entry.isFile() && !skippedName(entry.name) && !insideSkipped(folder, entry.parentPath))
    .map((entry) => path.join(entry.parentPath, entry.name))
  const prefix = `${root}${path.sep}`
  const known = new Map(
    db
      .all<Row>("select id, path, size, mtime from files where substr(path, 1, length(?)) = ?", prefix, prefix)
      .map((row) => [row.path, row]),
  )
  const infos = yield* Effect.forEach(
    found,
    (filepath) => Effect.promise(() => stat(filepath).then((info) => ({ filepath, info }), () => undefined)),
    { concurrency: STAT_CONCURRENCY },
  )
  let changed = 0

  db.transaction(() => {
    for (const item of infos) {
      if (!item) continue
      const row = known.get(item.filepath)

      known.delete(item.filepath)

      if (row && row.size === item.info.size && row.mtime === Math.round(item.info.mtimeMs)) continue
      upsert(db, folder, item.filepath, item.info, row)
      changed += 1
    }

    for (const row of known.values()) {
      db.run("delete from texts where rowid = ?", row.id)
      db.run("delete from files where id = ?", row.id)
    }
  })

  return { files: found.length, changed, removed: known.size }
})

/** Applies one change the watcher reported: a file is stored or dropped, a folder is scanned. */
export const change = Effect.fn("WorkIndex.change")(function* (db: WorkDatabase, folder: string, target: string) {
  if (insideSkipped(folder, path.dirname(target)) || skippedName(path.basename(target))) return
  const info = yield* Effect.promise(() => stat(target).catch(() => undefined))

  if (!info) {
    db.transaction(() => void removeUnder(db, target))

    return
  }

  if (info.isDirectory()) {
    if (!insideSkipped(folder, target)) yield* scan(db, folder, target)

    return
  }

  const row = db.get<Row>("select id, path, size, mtime from files where path = ?", target)

  if (row && row.size === info.size && row.mtime === Math.round(info.mtimeMs)) return
  db.transaction(() => upsert(db, folder, target, info, row))
})

/** Records the folders to index and their roles, and drops the files of folders no longer among them. */
export const track = (db: WorkDatabase, roots: readonly { folder: string; role: WorkSettings.Role }[]) =>
  db.transaction(() => {
    db.run("delete from roots")

    for (const root of roots) db.run("insert or ignore into roots (folder, role) values (?, ?)", root.folder, root.role)
    db.run("delete from texts where rowid in (select id from files where folder not in (select folder from roots))")
    db.run("delete from files where folder not in (select folder from roots)")
  })

/** Reads the text of the newest document still waiting. Returns false when none is waiting. */
export const extractNext = Effect.fn("WorkIndex.extractNext")(function* (db: WorkDatabase) {
  const row = db.get<{ id: number; path: string; size: number }>(
    "select id, path, size from files where text_state = 'pending' order by mtime desc limit 1",
  )

  if (!row) return false

  const settle = (state: TextState, reason: string | null, text?: string) =>
    db.transaction(() => {
      db.run("update files set text_state = ?, text_reason = ? where id = ?", state, reason, row.id)
      db.run("delete from texts where rowid = ?", row.id)

      if (text !== undefined) db.run("insert into texts (rowid, body) values (?, ?)", row.id, text.slice(0, MAX_TEXT))
    })

  if (row.size > DocumentText.MAX_DOCUMENT_BYTES) {
    settle("too-large", `larger than ${DocumentText.MAX_DOCUMENT_BYTES / 1024 / 1024} MiB`)

    return true
  }

  const bytes = yield* Effect.promise(() => readFile(row.path).then((buffer) => new Uint8Array(buffer), () => undefined))

  if (!bytes) {
    settle("unreadable", "it cannot be read")

    return true
  }

  const extracted = yield* DocumentExtract.fromBytes(row.path, bytes)

  if (extracted.status === "ready") settle("ready", null, extracted.text)
  else settle(extracted.status, extracted.reason)

  return true
})

/** Per tracked folder, in the order given: its role, files, documents, and how many documents' text is indexed or waiting. */
export function stats(db: WorkDatabase) {
  return db.all<{
    folder: string
    role: WorkSettings.Role
    files: number
    documents: number
    ready: number
    pending: number
  }>(
    `select r.folder, r.role, count(f.id) as files,
       sum(case when f.text_state is null or f.text_state = 'none' then 0 else 1 end) as documents,
       sum(case when f.text_state = 'ready' then 1 else 0 end) as ready,
       sum(case when f.text_state = 'pending' then 1 else 0 end) as pending
     from roots r left join files f on f.folder = r.folder group by r.folder order by min(r.rowid)`,
  )
}

export interface Query {
  /** Words that must all appear; none lists the newest files. */
  readonly words: readonly string[]
  readonly where: "all" | "name" | "content"
  /** A chosen folder, or a path inside one. */
  readonly folder?: string
  /** Only the folders with this role. */
  readonly role?: WorkSettings.Role
  readonly extensions?: readonly string[]
  /** Unix milliseconds. */
  readonly since?: number
  readonly until?: number
  readonly limit: number
}

export interface Hit {
  readonly path: string
  readonly folder: string
  readonly name: string
  readonly size: number
  readonly modified: number
  readonly match: "name" | "content" | "recent"
  readonly snippet?: string
}

const like = (word: string) => `%${word.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`

// The trigram tokenizer matches words of three or more characters; shorter ones fall back to LIKE.
const TRIGRAM = 3

/** Files whose path or text has every word, names first, then content by relevance; or the newest files. */
export function search(db: WorkDatabase, query: Query): Hit[] {
  const filters: string[] = []
  const params: Value[] = []

  if (query.folder) {
    filters.push("(f.folder = ? or substr(f.path, 1, length(?)) = ?)")
    const prefix = `${query.folder.replace(/[\\/]+$/, "")}${path.sep}`
    params.push(query.folder, prefix, prefix)
  }

  if (query.role) {
    filters.push("f.folder in (select folder from roots where role = ?)")
    params.push(query.role)
  }

  if (query.extensions?.length) {
    filters.push(`f.ext in (${query.extensions.map(() => "?").join(", ")})`)
    params.push(...query.extensions.map((ext) => ext.replace(/^\./, "").toLowerCase()))
  }

  if (query.since !== undefined) {
    filters.push("f.mtime >= ?")
    params.push(query.since)
  }

  if (query.until !== undefined) {
    filters.push("f.mtime <= ?")
    params.push(query.until)
  }

  const where = (extra: string[]) => {
    const all = [...filters, ...extra]

    return all.length ? `where ${all.join(" and ")}` : ""
  }

  const columns = "f.path, f.folder, f.name, f.size, f.mtime as modified"

  if (query.words.length === 0)
    return db
      .all<Omit<Hit, "match">>(`select ${columns} from files f ${where([])} order by f.mtime desc limit ?`, ...params, query.limit)
      .map((hit) => ({ ...hit, match: "recent" }))

  const hits = new Map<string, Hit>()

  if (query.where !== "content") {
    const names = db.all<Omit<Hit, "match">>(
      // A word in the chosen folder's own path, such as "메신저", would match every file in it.
      `select ${columns} from files f ${where(query.words.map(() => "substr(f.path, length(f.folder) + 2) like ? escape '\\'"))} order by f.mtime desc limit ?`,
      ...params,
      ...query.words.map(like),
      query.limit,
    )

    for (const hit of names) hits.set(hit.path, { ...hit, match: "name" })
  }

  if (query.where !== "name" && hits.size < query.limit) {
    const long = query.words.filter((word) => word.length >= TRIGRAM)
    const short = query.words.filter((word) => word.length < TRIGRAM)
    const match = long.map((word) => `"${word.replaceAll('"', '""')}"`).join(" AND ")
    const extra = [...(match ? ["texts match ?"] : []), ...short.map(() => "texts.body like ? escape '\\'")]
    const snippet = match
      ? "snippet(texts, 0, '«', '»', '…', 16)"
      : `substr(texts.body, max(instr(texts.body, ?) - 60, 1), 160)`
    const contents = db.all<Omit<Hit, "match">>(
      `select ${columns}, ${snippet} as snippet from texts join files f on f.id = texts.rowid ${where(extra)}
       order by ${match ? "bm25(texts)" : "f.mtime desc"} limit ?`,
      ...(match ? [] : [short[0] ?? ""]),
      ...params,
      ...(match ? [match] : []),
      ...short.map(like),
      query.limit,
    )

    for (const hit of contents) if (!hits.has(hit.path)) hits.set(hit.path, { ...hit, match: "content" })
  }

  return [...hits.values()].slice(0, query.limit)
}

/** Opens the index for reading, or undefined when there is none yet or this runtime cannot. */
export function reader(global: Pick<Global.Interface, "data" | "config">) {
  try {
    return openWorkDatabase(file(global), { readonly: true })
  } catch {
    return undefined
  }
}
