import type { SessionInfo } from "@opencode/client/promise"
import { homeProjectForSession } from "@/home/sessions/records"
import { compareSessionTime } from "@/shell/layout/helpers"

export interface Workroom<P> {
  readonly project: P
  /** Its top-level conversations, newest first. */
  readonly sessions: readonly SessionInfo[]
  /** When its newest conversation last changed; absent while it has none. */
  readonly updated?: number
}

/**
 * 자비수's 작업실 list: every added project with the conversations held in it, the most recently used first and rooms
 * without conversations last, in their own order. A conversation outside every added project is left out.
 */
export function groupWorkrooms<P extends { id?: string; worktree: string; sandboxes?: readonly string[] }>(
  projects: readonly P[],
  sessions: readonly SessionInfo[],
): Workroom<P>[] {
  const held = Map.groupBy(
    sessions.flatMap((session) => {
      const project = homeProjectForSession(session, projects)

      return project ? [{ project, session }] : []
    }),
    (entry) => entry.project,
  )

  return projects
    .map((project) => {
      const list = (held.get(project) ?? []).map((entry) => entry.session).toSorted(compareSessionTime)
      const newest = list[0]

      return { project, sessions: list, updated: newest ? (newest.time.updated ?? newest.time.created) : undefined }
    })
    .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
}
