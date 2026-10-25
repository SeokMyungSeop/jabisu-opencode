import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { ServerRef, Servers } from "../sdk"

/** A 집현전's name and source paths, as the engine lists them. */
export interface Listed {
  readonly name: string
  readonly sources: readonly string[]
}

/**
 * Lets every 집현전 view reload after any of them changes a 집현전, its sources or its instructions, and after files
 * change in the folders outside the app, such as in File Explorer.
 */
export interface Sync {
  readonly revision: Accessor<number>
  readonly changed: () => void
  /** Watches the folders while the caller shows a 집현전 view. Returns the function that stops it. */
  readonly watch: () => () => void
  /**
   * Calls `handler` when files arrive from outside the app in the 집현전 `name` names. Only the view registered last
   * for a 집현전 hears it, so a window over the side panel does not make the same 집현전 handle it twice.
   */
  readonly arrived: (name: () => string, handler: () => void) => () => void
}

// The folders are listed this often while a view shows and the window is seen, and at once when it comes back.
const POLL_MS = 3_000

// Windows can report a window that other windows cover as hidden even while it has focus.
const seenByUser = () => document.visibilityState === "visible" || document.hasFocus()

export function createSync(list: () => Promise<readonly Listed[] | undefined>): Sync {
  const [revision, setRevision] = createSignal(0)
  const handlers: { name: () => string; handler: () => void }[] = []
  let seen: Map<string, Set<string>> | undefined
  let viewers = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()

  // Checks run one at a time, so the baseline the app's own changes set is never overtaken by an older listing.
  const check = (report: boolean) => {
    queue = queue.then(async () => {
      const items = await list().catch(() => undefined)

      if (!items) return
      const previous = seen

      seen = new Map(items.map((item) => [item.name, new Set(item.sources)]))

      if (!report || !previous || same(previous, seen)) return
      setRevision((value) => value + 1)

      for (const item of items) {
        const before = previous.get(item.name)

        // A new 집현전 is not an arrival; the app made it, or the user will open it.
        if (!before || item.sources.every((source) => before.has(source))) continue
        handlers.findLast((entry) => entry.name() === item.name)?.handler()
      }
    })

    return queue
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = viewers > 0 ? setTimeout(tick, POLL_MS) : undefined
  }

  const tick = () => {
    if (!seenByUser()) return schedule()
    void check(true).finally(schedule)
  }

  const resume = () => {
    if (viewers > 0 && seenByUser()) tick()
  }

  window.addEventListener("focus", resume)
  document.addEventListener("visibilitychange", resume)
  onCleanup(() => {
    window.removeEventListener("focus", resume)
    document.removeEventListener("visibilitychange", resume)
    clearTimeout(timer)
  })

  return {
    revision,
    changed: () => {
      setRevision((value) => value + 1)
      void check(false)
    },
    watch: () => {
      viewers += 1

      if (viewers === 1) void check(true).finally(schedule)

      return () => {
        viewers -= 1
        schedule()
      }
    },
    arrived: (name, handler) => {
      const entry = { name, handler }

      handlers.push(entry)

      return () => {
        const index = handlers.indexOf(entry)

        if (index >= 0) handlers.splice(index, 1)
      }
    },
  }
}

function same(a: Map<string, Set<string>>, b: Map<string, Set<string>>) {
  if (a.size !== b.size) return false

  for (const [name, sources] of a) {
    const other = b.get(name)

    if (!other || other.size !== sources.size) return false

    for (const source of sources) if (!other.has(source)) return false
  }

  return true
}

/** The desktop's own server, which keeps the 집현전 folders on this PC. */
export const builtin = (servers: Servers) =>
  servers
    .list()
    .map((id) => servers.get(id))
    .find((item) => item?.builtin)

export const locationOf = (server: ServerRef) => ({ directory: server.data.location.default().directory })

const comparable = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

/** Whether two paths name the same folder, whatever their separators or, as on Windows, their case. */
export const sameDirectory = (a: string, b: string) => comparable(a) === comparable(b)
