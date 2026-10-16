export * as SessionContextUsage from "./context-usage.js"

import type { SessionContextUsage as Schema } from "@opencode/schema/session-context-usage"
import { Effect } from "effect"
import type { FileSystem } from "../filesystem.js"
import { CodeModeCatalog } from "../codemode/catalog.js"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Instructions } from "../instructions/index.js"
import { Mcp } from "../mcp/index.js"
import { Plugin } from "../plugin/service.js"
import { McpTool } from "../tool/mcp.js"
import { Token } from "../util/token.js"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import type { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import type { SessionRunnerModel } from "./runner/model.js"
import type { SessionSchema } from "./schema.js"

export type Error =
  | AgentNotFoundError
  | Instructions.InitializationBlocked
  | SessionRunnerModel.Error
  | FileSystem.DirectoryNotFoundError

/** Which category each built-in instruction source's text counts toward; plugin sources count as instructions. */
const sources: Readonly<Record<string, Schema.Category>> = {
  "core/codemode": "tools",
  "core/date": "system",
  "core/environment": "system",
  "core/instructions": "instructions",
  "core/mcp-guidance": "mcp",
  "core/reference-guidance": "instructions",
  "core/skill-guidance": "skills",
}

const order: ReadonlyArray<Schema.Category> = ["system", "tools", "mcp", "skills", "instructions", "messages"]

/**
 * Estimates how the session's next request divides among its parts, without mutating the Session. Instructions count
 * at their current text, not the updates history announced them with, so the parts show what the context holds now.
 */
export const estimate = Effect.fn("SessionContextUsage.estimate")(function* (input: { session: SessionSchema.Info }) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const mcp = yield* Mcp.Service
    const selection = yield* context.select(input.session.id)
    const model = yield* context.resolveModel(selection.session)
    const history = yield* SessionHistory.preview(
      database.db,
      selection.session.id,
      selection.instructions,
      SessionProviderContext.provenance(model) ?? "local",
    )
    const tokens = new Map<Schema.Category, number>(order.map((category) => [category, 0]))
    const add = (category: Schema.Category, count: number) => tokens.set(category, (tokens.get(category) ?? 0) + count)

    // The agent prompt alone; the instructions are counted per source below.
    const base = SessionModelRequest.baseTranscript({
      agent: selection.agent.info,
      model,
      tools: selection.tools,
      initial: "",
      messages: [],
    })
    base.system.forEach((part) => add("system", Token.estimate(part.text)))
    selection.tools.definitions.forEach((tool) => add("tools", SessionCompaction.estimateTool(tool)))

    const observed = yield* Instructions.read(selection.instructions)
    selection.instructions.forEach((source, index) => {
      const value = observed[index]?.value
      if (value === undefined || value === Instructions.unavailable || value === Instructions.removed) return
      const text = source.initial(value)
      if (text) add(sources[source.key] ?? "instructions", Token.estimate(text))
    })

    // MCP tools reach the model through the Code Mode catalog, listed under their server's namespace.
    const catalog = selection.tools.codeModeCatalog
    if (catalog) {
      const servers = new Set((yield* mcp.tools()).map((tool) => McpTool.namespace(tool.server)))
      const listed = CodeModeCatalog.summarize(catalog)
        .namespaces.filter((namespace) => servers.has(namespace.name))
        .reduce(
          (sum, namespace) =>
            sum +
            Token.estimate(
              [CodeModeCatalog.namespaceLine(namespace), ...namespace.entries.map((entry) => entry.line)].join("\n"),
            ),
          0,
        )
      const moved = Math.min(listed, tokens.get("tools") ?? 0)
      add("tools", -moved)
      add("mcp", moved)
    }

    // System messages announced instruction updates, which the sources above already count at their current text.
    const conversation = history.messages.filter((message) => message.type !== "system")
    const count = (messages: typeof conversation) =>
      toLLMMessages(messages, model.ref, base.providerMetadataKey).reduce(
        (sum, message) => sum + SessionCompaction.estimateMessage(message),
        0,
      )
    add("skills", count(conversation.filter((message) => message.type === "skill")))
    add("messages", count(conversation.filter((message) => message.type !== "skill")))

    return {
      categories: order.map((category) => ({ category, tokens: Math.max(0, Math.round(tokens.get(category) ?? 0)) })),
    } satisfies Schema.Info
  }).pipe(instances.provide(input.session))
})
