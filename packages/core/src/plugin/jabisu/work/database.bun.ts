import { Database } from "bun:sqlite"
import type { Value, WorkDatabase } from "./database-types.js"

/** Opens the work index with Bun's SQLite, which has FTS5 and its trigram tokenizer. */
export function openWorkDatabase(
  filename: string,
  options: { readonly readonly?: boolean } = {},
): WorkDatabase | undefined {
  const db = options.readonly ? new Database(filename, { readonly: true }) : new Database(filename, { create: true })

  if (!options.readonly) db.run("pragma journal_mode = wal")
  db.run("pragma busy_timeout = 3000")

  return {
    run: (sql, ...params) => void db.query<unknown, Value[]>(sql).run(...params),
    all: <T>(sql: string, ...params: Value[]) => db.query<T, Value[]>(sql).all(...params),
    get: <T>(sql: string, ...params: Value[]) => db.query<T, Value[]>(sql).get(...params) ?? undefined,
    transaction: (body) => db.transaction(body)(),
    close: () => db.close(),
  }
}
