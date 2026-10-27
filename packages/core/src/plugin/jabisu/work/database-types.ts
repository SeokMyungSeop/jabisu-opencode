/** A value SQLite stores. */
export type Value = string | number | null

/** The work index's SQLite file, through the runtime's own driver. */
export interface WorkDatabase {
  run(sql: string, ...params: Value[]): void
  all<T>(sql: string, ...params: Value[]): T[]
  get<T>(sql: string, ...params: Value[]): T | undefined
  /** Runs `body` in one transaction. */
  transaction(body: () => void): void
  close(): void
}
