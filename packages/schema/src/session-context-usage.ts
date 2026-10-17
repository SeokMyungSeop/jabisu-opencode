export * as SessionContextUsage from "./session-context-usage.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

export const Category = Schema.Literals(["system", "tools", "mcp", "skills", "instructions", "messages"]).annotate({
  identifier: "SessionContextUsage.Category",
  description:
    "What part of the context the tokens hold: `system` the agent prompt, date and environment; `tools` tool definitions and the Code Mode catalog; `mcp` MCP server guidance and their Code Mode tools; `skills` the skill catalog and loaded skills; `instructions` instruction files such as AGENTS.md, references and plugin instructions; `messages` the conversation",
})
export type Category = typeof Category.Type

export const Entry = Schema.Struct({
  category: Category,
  tokens: NonNegativeInt.annotate({ description: "Estimated tokens, at about four characters each" }),
}).annotate({ identifier: "SessionContextUsage.Entry" })
export type Entry = typeof Entry.Type

export const Info = Schema.Struct({
  categories: Schema.Array(Entry).annotate({
    description:
      "Estimated size of each part of the session's next request, from the current instructions, tools and history; the provider's count of the last request can differ",
  }),
}).annotate({ identifier: "SessionContextUsage" })
export type Info = typeof Info.Type
