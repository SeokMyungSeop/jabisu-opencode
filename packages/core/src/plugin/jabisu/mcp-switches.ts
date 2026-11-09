export * as JabisuMcp from "./mcp-switches.js"

import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Data, Effect, Schema } from "effect"
import path from "path"

// The MCP servers the user turned on or off in 설정 → 확장 → MCP, or by turning on a skill that needs one. A choice
// holds for every 작업실 and survives a restart; Ctrl+; still connects or disconnects a server in one 작업실 for now.

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Pick<Global.Interface, "config">
}

export class McpSwitchError extends Data.TaggedError("JabisuMcpSwitchError")<{ readonly reason: string }> {}

/** The file that holds the user's choices, next to the skill switches; 자비수's own, so OpenCode never reads it. */
export const switches = (global: Pick<Global.Interface, "config">) => path.join(global.config, "jabisu-mcp.json")

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ on: Schema.Record(Schema.String, Schema.Boolean) })),
)

/** The servers the user turned on or off; none when the file is missing or unreadable. */
export const chosen = Effect.fn("JabisuMcp.chosen")(function* (deps: Dependencies) {
  const text = yield* deps.fs.readFileStringSafe(switches(deps.global)).pipe(Effect.orElseSucceed(() => undefined))
  const parsed = text === undefined ? undefined : decode(text)

  return parsed?._tag === "Some" ? parsed.value.on : {}
})

/** Turns a server on or off for every 작업실 from now. */
export const turn = Effect.fn("JabisuMcp.turn")(function* (deps: Dependencies, name: string, on: boolean) {
  const choices = yield* chosen(deps)

  yield* deps.fs
    .writeWithDirs(switches(deps.global), JSON.stringify({ on: { ...choices, [name]: on } }, null, 2))
    .pipe(Effect.mapError(() => new McpSwitchError({ reason: `${switches(deps.global)} cannot be written` })))

  return { ...choices, [name]: on }
})
