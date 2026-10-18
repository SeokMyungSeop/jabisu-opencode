/// <reference path="../markdown.d.ts" />
/// <reference path="./jabisu/assets.d.ts" />

export * as JabisuPlugin from "./jabisu.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Effect } from "effect"
import path from "path"
import { SkillFile } from "../config/plugin/skill-file.js"
import codebaseDesign from "./jabisu/skills/codebase-design/SKILL.md" with { type: "text" }
import codebaseDesignDeepening from "./jabisu/skills/codebase-design/DEEPENING.md" with { type: "text" }
import codebaseDesignTwice from "./jabisu/skills/codebase-design/DESIGN-IT-TWICE.md" with { type: "text" }
import diagnosingBugs from "./jabisu/skills/diagnosing-bugs/SKILL.md" with { type: "text" }
import diagnosingBugsLoop from "./jabisu/skills/diagnosing-bugs/scripts/hitl-loop.template.sh" with { type: "text" }
import grillMe from "./jabisu/skills/grill-me/SKILL.md" with { type: "text" }
import grilling from "./jabisu/skills/grilling/SKILL.md" with { type: "text" }
import handoff from "./jabisu/skills/handoff/SKILL.md" with { type: "text" }
import tdd from "./jabisu/skills/tdd/SKILL.md" with { type: "text" }
import tddMocking from "./jabisu/skills/tdd/mocking.md" with { type: "text" }
import tddTests from "./jabisu/skills/tdd/tests.md" with { type: "text" }

// 자비수(諮備秀) ships six of Matt Pocock's skills (mattpocock/skills 1.3.1, MIT — jabisu/LICENSE.mattpocock-skills)
// and offers Context7 as an MCP server that stays off until the user turns it on. Other channels get neither.
const files: ReadonlyArray<readonly [file: string, content: string]> = [
  ["codebase-design/SKILL.md", codebaseDesign],
  ["codebase-design/DEEPENING.md", codebaseDesignDeepening],
  ["codebase-design/DESIGN-IT-TWICE.md", codebaseDesignTwice],
  ["diagnosing-bugs/SKILL.md", diagnosingBugs],
  ["diagnosing-bugs/scripts/hitl-loop.template.sh", diagnosingBugsLoop],
  ["grill-me/SKILL.md", grillMe],
  ["grilling/SKILL.md", grilling],
  ["handoff/SKILL.md", handoff],
  ["tdd/SKILL.md", tdd],
  ["tdd/mocking.md", tddMocking],
  ["tdd/tests.md", tddTests],
]

export const Plugin = define({
  id: "jabisu.defaults",
  effect: Effect.fn(function* (ctx) {
    if (ctx.app.channel !== "jabisu") return
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    // Skills point at their sibling files by relative path, so the bundle is written out once per content version.
    const root = path.join(global.cache, "skills", `jabisu-${Hash.fast(files.map(([, content]) => content).join("\0"))}`)

    for (const [file, content] of files) {
      const target = path.join(root, file)

      if (yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))) continue
      yield* fs
        .writeWithDirs(target, content)
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to write bundled skill file", { target, cause })))
    }

    const skills = files.flatMap(([file, content]) => {
      if (path.basename(file) !== "SKILL.md") return []
      const parsed = SkillFile.parse(root, path.join(root, file), content)

      return parsed._tag === "Parsed" ? [parsed.skill] : []
    })

    // Runs after the built-in skills and before configured ones, so a user's skill with the same name replaces these.
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
    // Configured servers are applied before this plugin, so a configured context7 is kept as it is.
    yield* ctx.mcp.transform((editor) => {
      if (editor.get("context7")) return
      editor.set("context7", { type: "remote", url: "https://mcp.context7.com/mcp", disabled: true })
    })
  }),
})
