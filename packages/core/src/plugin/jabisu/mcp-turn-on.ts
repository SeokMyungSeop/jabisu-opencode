export * as McpTurnOn from "./mcp-turn-on.js"

import { ToolFailure } from "@opencode/ai"
import type { Mcp } from "@opencode/schema/mcp"
import { Effect, Schema } from "effect"
import { JabisuMcp } from "./mcp-switches.js"

// A skill that works through an MCP server is no use while the server is off, and the model cannot press Ctrl+; for
// the user. When the user chose to turn such a skill on, the model turns its server on with this tool: in this
// 작업실 until 자비수 restarts, or for every 작업실 when the user chose 「항상 켜기」.

export const name = "mcp_turn_on"

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The MCP server to turn on, as the instructions name it" }),
  always: Schema.optional(Schema.Boolean).annotate({
    description: "true only when the user chose 「항상 켜기」, to keep the server on in every 작업실",
  }),
})

export const Output = Schema.Struct({ id: Schema.String })

/** What the tool needs from the 작업실 it runs in. */
export interface Here {
  /** Keeps the server on in this 작업실 until 자비수 restarts. */
  readonly keep: (id: string) => void
  /** Applies the servers' on and off again, connecting the ones turned on. */
  readonly reload: Effect.Effect<void>
  readonly servers: Effect.Effect<ReadonlyArray<Mcp.Server>>
}

// A remote server answers its first request within seconds; give up on one still starting after 15.
const WAIT_MS = 500
const WAIT_TIMES = 30

/** The tool that turns on an MCP server a skill works through, after the user chose to turn that skill on. */
export function tool(deps: JabisuMcp.Dependencies, here: Here) {
  return {
    name,
    options: { codemode: false },
    description:
      "Turn on an MCP server that a skill works through, after the user chose to turn that skill on. Its tools are available as soon as it connects.",
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type) =>
      Effect.gen(function* () {
        const known = yield* here.servers
        if (!known.some((server) => server.name === input.id))
          return yield* new ToolFailure({
            message: `${input.id} is not an MCP server here; the servers are ${known.map((server) => server.name).join(", ")}`,
          })

        if (input.always)
          yield* JabisuMcp.turn(deps, input.id, true).pipe(
            Effect.mapError((error) => new ToolFailure({ message: error.reason })),
          )
        here.keep(input.id)
        yield* here.reload

        const status = yield* Effect.gen(function* () {
          for (const _ of Array.from({ length: WAIT_TIMES })) {
            const current = (yield* here.servers).find((server) => server.name === input.id)?.status
            if (current?.status !== "pending") return current
            yield* Effect.sleep(WAIT_MS)
          }
          return undefined
        })

        if (status?.status === "connected")
          return {
            output: { id: input.id },
            content: `${input.id} is connected${input.always ? " in every 작업실 from now" : " in this 작업실 until 자비수 restarts"}. Its tools are available now; find them with the tool search.`,
          }

        return yield* new ToolFailure({
          message: `${input.id} did not connect (${status ? (status.status === "failed" || status.status === "needs_auth" ? `${status.status}: ${status.error}` : status.status) : "still starting after 15 seconds"}). Tell the user it can be turned on in 설정 → 확장 → MCP, and do not compute the answer by hand.`,
        })
      }),
  }
}
