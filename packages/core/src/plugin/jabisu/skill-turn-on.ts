export * as SkillTurnOn from "./skill-turn-on.js"

import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { JabisuSkills } from "./skills.js"

// The model offers a bundled skill that is off when a request needs it; when the user chooses to keep it on, this
// turns it on for every chat from then. Loading it for the current chat is the skill tool's job.

export const name = "skill_turn_on"

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The ID of a bundled skill that is off, as the instructions list it" }),
})

export const Output = Schema.Struct({ id: Schema.String })

/** The tool that keeps a bundled skill on once the user chose 「항상 켜기」. */
export function tool(deps: JabisuSkills.Dependencies) {
  return {
    name,
    options: { codemode: false },
    description:
      "Turn on, for every chat from now, a bundled skill that is off, after the user chose 「항상 켜기」 when you offered it. Then load it with the skill tool to use it now.",
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type) =>
      JabisuSkills.turn(deps, input.id, true).pipe(
        Effect.map(() => ({
          output: { id: input.id },
          content: `${input.id} is on for every chat from now. Load it with the skill tool to use it in this chat.`,
        })),
        Effect.mapError((error) => new ToolFailure({ message: error.reason })),
      ),
  }
}
