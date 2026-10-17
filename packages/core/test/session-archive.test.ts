import { describe, expect } from "bun:test"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionArchiveWorktree } from "@opencode/core/session/archive-worktree"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Worktree } from "@opencode/core/worktree"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const directory = (...parts: string[]) => AbsolutePath.make(path.resolve("/archive-test", ...parts))
const checkout = directory("project")
const worktree = directory("worktrees", "task")
const probe = directory("worktrees", "probe")

// Worktree releases this test observes; each waiter resolves when its directory is released.
const released: AbsolutePath[] = []
const waiting = new Map<string, Deferred.Deferred<void>>()

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionArchiveWorktree.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      Worktree.node.replace(
        Layer.mock(Worktree.Service, {
          list: () =>
            Effect.succeed([
              { directory: checkout, strategy: undefined },
              { directory: worktree, strategy: "git" },
              { directory: probe, strategy: "git" },
            ]),
          release: (input) =>
            Effect.gen(function* () {
              released.push(input.directory)
              const waiter = waiting.get(input.directory)
              if (waiter) yield* Deferred.succeed(waiter, undefined)
              return { removed: true } as const
            }),
        }),
      ),
    ],
  ),
)

const at = (directory: AbsolutePath) => Location.Ref.make({ directory })

// Archive cleanups run in order, so once the probe's worktree is released every earlier archive has been handled.
const settle = Effect.fnUntraced(function* (session: Session.Interface) {
  const waiter = yield* Deferred.make<void>()
  waiting.set(probe, waiter)
  const created = yield* session.create({ location: at(probe) })
  yield* session.archive(created.id)
  yield* Deferred.await(waiter)
})

describe("Session.archive", () => {
  it.effect("archives and restores a session once each, without changing its recency", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location: at(checkout) })

      yield* session.archive(created.id)
      yield* session.archive(created.id)
      const archived = yield* session.get(created.id)
      expect(archived.time.archived).toBeDefined()
      expect(archived.time.updated).toEqual(created.time.updated)

      yield* session.unarchive(created.id)
      yield* session.unarchive(created.id)
      const restored = yield* session.get(created.id)
      expect(restored.time.archived).toBeUndefined()
      expect(restored.time.updated).toEqual(created.time.updated)

      const types = (yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .all()).map((event) => event.type)
      expect(types.filter((type) => type === Bus.versionedType(SessionEvent.Archived.type, 1))).toHaveLength(1)
      expect(types.filter((type) => type === Bus.versionedType(SessionEvent.Unarchived.type, 1))).toHaveLength(1)
    }),
  )

  it.effect("rejects an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing_archive")
      expect(yield* Effect.flip(session.archive(sessionID))).toEqual(new Session.NotFoundError({ sessionID }))
    }),
  )

  it.effect("releases an archived session's worktree only once no other unarchived session runs in it", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      released.length = 0
      const first = yield* session.create({ location: at(directory("worktrees", "task", "src")) })
      const second = yield* session.create({ location: at(worktree) })
      const child = yield* session.create({ parentID: second.id })
      const main = yield* session.create({ location: at(checkout) })

      // The checkout has no worktree strategy, a subagent defers to its parent, and the second session still runs
      // in the first one's worktree.
      yield* session.archive(main.id)
      yield* session.archive(child.id)
      yield* session.archive(first.id)
      yield* settle(session)
      expect(released).toEqual([probe])

      const waiter = yield* Deferred.make<void>()
      waiting.set(worktree, waiter)
      yield* session.archive(second.id)
      yield* Deferred.await(waiter)
      expect(released).toEqual([probe, worktree])
    }),
  )
})
