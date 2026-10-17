export * as SessionArchiveWorktree from "./archive-worktree.js"

import { and, eq, isNull, ne } from "drizzle-orm"
import { Context, Effect, Layer, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Worktree } from "../worktree.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"
import { SessionStore } from "./store.js"

/**
 * Removes the worktree an archived session ran in once nothing needs it: after the session goes idle, while it stays
 * archived and no other unarchived session runs in that worktree. `Worktree.release` decides the rest. Listens to live
 * events rather than projecting, so replaying history never removes anything.
 */
export class Service extends Context.Service<Service, {}>()("@opencode/SessionArchiveWorktree") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db
    const execution = yield* SessionExecution.Service
    const sessions = yield* SessionStore.Service
    const worktrees = yield* Worktree.Service

    const release = Effect.fn("SessionArchiveWorktree.release")(function* (sessionID: SessionSchema.ID) {
      yield* execution.awaitIdle(sessionID)
      const session = yield* sessions.get(sessionID)
      // Subagents run in their parent's checkout, whose own archive decides.
      if (!session || session.parentID || session.time.archived === undefined) return
      const directory = session.location.directory
      const owner = (yield* worktrees.list({ projectID: session.projectID }))
        .filter((entry) => entry.strategy !== undefined && FSUtil.contains(entry.directory, directory))
        .toSorted((left, right) => right.directory.length - left.directory.length)[0]
      if (!owner) return
      const others = (yield* db
        .select({ directory: SessionTable.directory })
        .from(SessionTable)
        .where(
          and(
            eq(SessionTable.project_id, session.projectID),
            isNull(SessionTable.time_archived),
            ne(SessionTable.id, sessionID),
          ),
        )
        .all()
        .pipe(Effect.orDie)).filter((row) => FSUtil.contains(owner.directory, row.directory))
      if (others.length > 0) {
        yield* Effect.logInfo("kept archived session's worktree", {
          sessionID,
          directory: owner.directory,
          reason: "in use",
        })
        return
      }
      const result = yield* worktrees.release({ projectID: session.projectID, directory: owner.directory })
      if (result.removed) {
        yield* Effect.logInfo("removed archived session's worktree", { sessionID, directory: owner.directory })
        return
      }
      yield* Effect.logInfo("kept archived session's worktree", {
        sessionID,
        directory: owner.directory,
        reason: result.reason,
      })
    })

    // Each archive waits for its own session to go idle, so one busy session never holds up another's cleanup.
    yield* bus.subscribe(SessionEvent.Archived).pipe(
      Stream.runForEach((event) =>
        release(event.data.sessionID).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to release archived session's worktree", {
              sessionID: event.data.sessionID,
              cause,
            }),
          ),
          Effect.forkScoped,
        ),
      ),
      Effect.forkScoped,
    )

    return Service.of({})
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, SessionExecution.node, SessionStore.node, Worktree.node],
})
