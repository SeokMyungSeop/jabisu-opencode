export * as WorkIndexer from "./indexer.js"

import { openWorkDatabase } from "#jabisu-work-database"
import { Effect } from "effect"
import { watch, type FSWatcher } from "node:fs"
import path from "path"
import { WorkIndex } from "./index.js"
import { WorkSettings } from "./settings.js"

// The one writer of the work index, running for the server's lifetime: it follows 자비수's work folder and the chosen
// folders, records each one's role, scans each
// when it is added and at every start, applies what the watcher reports, rescans now and then in case the watcher
// missed something, and reads documents' text one at a time while nothing else is waiting.

// How often the settings are read again and changes applied when there is nothing else to do.
const IDLE_MS = 2_000
// A full rescan in case the watcher missed changes, such as while its buffer overflowed.
const RESCAN_MS = 30 * 60_000
// Documents read per round before changes and settings are looked at again.
const TEXT_BATCH = 4

export const run = Effect.fn("WorkIndexer.run")(function* (deps: WorkSettings.Dependencies) {
  // No index file is made until there is a folder to index.
  while ((yield* WorkSettings.roots(deps)).length === 0) yield* Effect.sleep(IDLE_MS)
  yield* deps.fs.makeDirectory(path.dirname(WorkIndex.file(deps.global)), { recursive: true }).pipe(Effect.ignore)
  const db = openWorkDatabase(WorkIndex.file(deps.global))

  if (!db) return
  WorkIndex.migrate(db)

  const watchers = new Map<string, FSWatcher>()
  const changed = new Map<string, Set<string>>()
  const scanned = new Map<string, number>()
  const tracked = { roots: "" }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const watcher of watchers.values()) watcher.close()
      db.close()
    }),
  )

  const follow = (folder: string) => {
    try {
      const watcher = watch(folder, { recursive: true }, (_event, name) => {
        const pending = changed.get(folder) ?? new Set<string>()

        // A change without a name means the watcher lost track; the folder is scanned again.
        if (name) pending.add(path.join(folder, name.toString()))
        else scanned.delete(folder)
        changed.set(folder, pending)
      })

      watcher.on("error", () => {
        watchers.delete(folder)
        scanned.delete(folder)
      })
      watchers.set(folder, watcher)
    } catch {
      // A folder that cannot be watched is still rescanned on schedule.
    }
  }

  const round = Effect.gen(function* () {
    const roots = yield* WorkSettings.roots(deps)
    const folders = roots.map((root) => root.folder)
    const chosen = new Set(folders)
    const signature = JSON.stringify(roots)

    for (const folder of [...watchers.keys()])
      if (!chosen.has(folder)) {
        watchers.get(folder)?.close()
        watchers.delete(folder)
        changed.delete(folder)
        scanned.delete(folder)
      }

    if (signature !== tracked.roots) {
      WorkIndex.track(db, roots)
      tracked.roots = signature
    }

    const now = Date.now()

    for (const folder of folders) {
      if (!watchers.has(folder)) follow(folder)

      if (now - (scanned.get(folder) ?? 0) > RESCAN_MS) {
        changed.delete(folder)
        yield* WorkIndex.scan(db, folder)
        scanned.set(folder, now)
      }

      const pending = changed.get(folder)

      if (!pending?.size) continue
      changed.set(folder, new Set())

      for (const target of pending) yield* WorkIndex.change(db, folder, target)
    }

    let read = 0

    while (read < TEXT_BATCH && (yield* WorkIndex.extractNext(db))) read += 1

    return read
  })

  yield* round.pipe(
    Effect.catchCause((cause) => Effect.logWarning("work index round failed", { cause }).pipe(Effect.as(0))),
    Effect.flatMap((read) => (read === TEXT_BATCH ? Effect.yieldNow : Effect.sleep(IDLE_MS))),
    Effect.forever,
  )
})
