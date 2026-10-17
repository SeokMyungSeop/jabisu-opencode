import { createMemo, type Accessor } from "solid-js"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import type { MountedSession } from "../sdk"
import { catalogModel, syncCatalog } from "./catalog"

/**
 * The routed session's context use as the header indicator and the session details show it, loading the catalogs its
 * model's limit comes from.
 */
export function createSessionUsage(session: Accessor<MountedSession>) {
  syncCatalog(session)

  const messages = createMemo(() => {
    const current = session()

    return current.id ? current.server.data.session.message.list(current.id) : []
  })

  const info = createMemo(() => {
    const current = session()

    return current.id ? current.server.data.session.get(current.id) : undefined
  })

  // Same step as the TUI: after the last completed compaction and before an undo boundary.
  const context = createMemo(() => {
    const message = lastAssistantWithUsage(messages(), info()?.revert?.messageID)

    if (!message) return
    const limit = catalogModel(session(), message.model)?.model?.limit.context

    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write

    return { total, limit, usage: limit ? Math.round((total / limit) * 100) : null }
  })

  // A root session's cost includes its subagent sessions, as in the TUI.
  const spent = createMemo(() => {
    const current = session()

    return current.id ? current.server.data.session.cost(current.id) : 0
  })

  // Spend anywhere in the family keeps the cost visible, even when this session's model is free.
  const showCost = createMemo(() => {
    if (spent() > 0) return true
    const ref = info()?.model ?? messages().findLast((item) => item.type === "assistant")?.model
    const model = ref ? catalogModel(session(), ref)?.model : undefined

    if (!model) return true

    return model.cost.some((cost) => cost.input > 0 || cost.output > 0 || cost.cache.read > 0 || cost.cache.write > 0)
  })

  return { context, spent, showCost }
}
