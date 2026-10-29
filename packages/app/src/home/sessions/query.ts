import type { SessionInfo } from "@opencode/client/promise"
import { queryOptions, skipToken } from "@tanstack/solid-query"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { HOME_SESSION_LIMIT, loadHomeSessionIndex, mergeHomeSessionIndex, retainHomeSessions } from "./index"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

/** A server's recent top-level sessions, one query that Home and 자비수's 작업실 list share. */
export function homeSessionQuery(ctx: ServerCtx | undefined, conn: ServerConnection.Any | undefined) {
  return queryOptions({
    queryKey: ["home-sessions", conn] as const,
    enabled: !!ctx && ctx.sdk.connection.status() === "connected",
    queryFn: ctx
      ? ({ signal }) => loadHomeSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal)
      : skipToken,
    retry: false,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    select: selectSessions,
  })
}

/** The fetched index with the sessions the server store knows merged in, as Home lists them. */
export function homeSessions(ctx: ServerCtx, fetched: SessionInfo[]) {
  return retainHomeSessions(
    ctx.data.session.apply(mergeHomeSessionIndex(fetched, ctx.data.session.list())),
    HOME_SESSION_LIMIT,
    Date.now(),
  )
}
