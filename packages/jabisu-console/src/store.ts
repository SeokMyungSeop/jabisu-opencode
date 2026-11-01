// The console's records in one SQLite file: who agreed to the notice, what each request used, and the model checks.
// Prompts and answers are never stored; a usage row holds only counts and money.
import { DatabaseSync } from "node:sqlite"
import { day, month } from "./clock.ts"

export interface Usage {
  readonly time: number
  readonly install: string
  readonly ip: string
  readonly model: string
  readonly free: boolean
  readonly question: boolean
  /** Dollars OpenRouter charged; 0 for a free model. */
  readonly cost: number
  readonly input: number
  readonly output: number
  readonly status: number
}

export interface Check {
  readonly time: number
  readonly chain: readonly string[]
  readonly log: readonly { model: string; ok: boolean; ms: number; reason?: string }[]
}

export type Store = ReturnType<typeof open>

export function open(file: string) {
  const db = new DatabaseSync(file)

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS consent (install TEXT, version TEXT, ip TEXT, time INTEGER, PRIMARY KEY (install, version));
    CREATE TABLE IF NOT EXISTS install (install TEXT PRIMARY KEY, first_day TEXT, first_time INTEGER);
    CREATE TABLE IF NOT EXISTS usage (
      time INTEGER, day TEXT, month TEXT, install TEXT, ip TEXT, model TEXT,
      free INTEGER, question INTEGER, cost REAL, input INTEGER, output INTEGER, status INTEGER
    );
    CREATE INDEX IF NOT EXISTS usage_day ON usage (day, install);
    CREATE INDEX IF NOT EXISTS usage_month ON usage (month);
    CREATE TABLE IF NOT EXISTS checks (time INTEGER, chain TEXT, log TEXT);
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
  `)

  const number = (sql: string, ...values: (string | number)[]) =>
    Number(Object.values(db.prepare(sql).get(...values) ?? {})[0] ?? 0)

  return {
    close: () => db.close(),

    /** Notes that an install agreed to a version of the notice; the first time counts. */
    consent(install: string, version: string, ip: string, time: number) {
      db.prepare("INSERT OR IGNORE INTO consent VALUES (?, ?, ?, ?)").run(install, version, ip, time)
    },

    /** The day an install first used the console, set by its first request. */
    firstDay(install: string, time: number) {
      db.prepare("INSERT OR IGNORE INTO install VALUES (?, ?, ?)").run(install, day(time), time)
      return String((db.prepare("SELECT first_day FROM install WHERE install = ?").get(install) ?? {}).first_day)
    },

    firstDayOf(install: string) {
      const row = db.prepare("SELECT first_day FROM install WHERE install = ?").get(install)
      return row ? String(row.first_day) : undefined
    },

    record(usage: Usage) {
      db.prepare("INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        usage.time,
        day(usage.time),
        month(usage.time),
        usage.install,
        usage.ip,
        usage.model,
        usage.free ? 1 : 0,
        usage.question ? 1 : 0,
        usage.cost,
        usage.input,
        usage.output,
        usage.status,
      )
    },

    /** Dollars of paid use: one install's, one address's, or everyone's on a day; everyone's in a month. */
    spent: {
      install: (install: string, on: string) =>
        number("SELECT SUM(cost) FROM usage WHERE day = ? AND install = ?", on, install),
      ip: (ip: string, on: string) => number("SELECT SUM(cost) FROM usage WHERE day = ? AND ip = ?", on, ip),
      day: (on: string) => number("SELECT SUM(cost) FROM usage WHERE day = ?", on),
      month: (on: string) => number("SELECT SUM(cost) FROM usage WHERE month = ?", on),
    },

    /** Requests a free model answered for an install on a day. */
    freeUsed: (install: string, on: string) =>
      number("SELECT COUNT(*) FROM usage WHERE day = ? AND install = ? AND free = 1", on, install),

    /** Times of an install's questions since a moment, oldest first. */
    questions: (install: string, since: number) =>
      db
        .prepare("SELECT time FROM usage WHERE install = ? AND question = 1 AND time >= ? ORDER BY time")
        .all(install, since)
        .map((row) => Number(row.time)),

    saveCheck(check: Check) {
      db.prepare("INSERT INTO checks VALUES (?, ?, ?)").run(
        check.time,
        JSON.stringify(check.chain),
        JSON.stringify(check.log),
      )
    },

    lastCheck(): Check | undefined {
      const row = db.prepare("SELECT * FROM checks ORDER BY time DESC LIMIT 1").get()
      if (!row) return undefined
      return { time: Number(row.time), chain: JSON.parse(String(row.chain)), log: JSON.parse(String(row.log)) }
    },

    get: (key: string) => {
      const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key)
      return row ? String(row.value) : undefined
    },
    set: (key: string, value: string) => {
      db.prepare("INSERT INTO state VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
        key,
        value,
      )
    },

    /** What the admin page shows: totals per day, and per install for one day. */
    report(on: string, since: string) {
      const days = db
        .prepare(
          "SELECT day, SUM(cost) AS cost, SUM(free) AS free, COUNT(*) AS requests, COUNT(DISTINCT install) AS installs FROM usage WHERE day >= ? GROUP BY day ORDER BY day",
        )
        .all(since)
      const installs = db
        .prepare(
          `SELECT u.install, i.first_day, SUM(u.cost) AS cost, SUM(u.free) AS free, COUNT(*) AS requests, SUM(u.question) AS questions,
             MAX(u.time) AS last, (SELECT COUNT(DISTINCT ip) FROM usage WHERE install = u.install AND day = ?) AS ips
           FROM usage u LEFT JOIN install i ON i.install = u.install WHERE u.day = ? GROUP BY u.install ORDER BY cost DESC, requests DESC`,
        )
        .all(on, on)
      const consents = number("SELECT COUNT(*) FROM consent")
      const models = db
        .prepare(
          "SELECT model, COUNT(*) AS requests, SUM(cost) AS cost FROM usage WHERE day = ? GROUP BY model ORDER BY requests DESC",
        )
        .all(on)
      return { days, installs, consents, models }
    },
  }
}
