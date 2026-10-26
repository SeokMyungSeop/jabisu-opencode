/// <reference path="../markdown.d.ts" />
/// <reference path="./jabisu/assets.d.ts" />

export * as JabisuPlugin from "./jabisu.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Effect, Option } from "effect"
import path from "path"
import { SkillFile } from "../config/plugin/skill-file.js"
import { FilmCraft } from "./jabisu/filmcraft.js"
import { Jiphyeonjeon } from "./jabisu/jiphyeonjeon.js"
import { JabisuSkills } from "./jabisu/skills.js"
import { SourceSearch } from "./jabisu/source-search.js"

// 자비수(諮備秀) ships six of Matt Pocock's skills (mattpocock/skills 1.3.1, MIT — jabisu/LICENSE.mattpocock-skills),
// the hwpx skill (jkf87/hwpx-skill, MIT — jabisu/LICENSE.hwpx-skill), its own docx, xlsx, pptx and craft-apps skills,
// and offers Context7, and FilmCraft when it is installed, as MCP servers that stay off until the user turns them on.
// Other channels get none of these.

// A folder another 자비수 version wrote may still be in use by that version for a while.
const STALE_MS = 86_400_000

export const Plugin = define({
  id: "jabisu.defaults",
  effect: Effect.fn(function* (ctx) {
    if (ctx.app.channel !== "jabisu") return
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const contents = yield* JabisuSkills.files({ fs, global })
    // Skills point at their sibling files by relative path, so the bundle is written out once per content version.
    const parent = path.join(global.cache, "skills")
    const root = path.join(
      parent,
      `jabisu-${Hash.fast(contents.map((file) => `${file.path}\0${Hash.fast(Buffer.from(file.content))}`).join("\0"))}`,
    )

    for (const file of contents) {
      const target = path.join(root, file.path)

      if (yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))) continue
      yield* fs
        .writeWithDirs(target, file.content)
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to write bundled skill file", { target, cause })))
    }

    // Earlier versions' folders are no longer used once a day has passed since they were written.
    const now = Date.now()
    const entries = yield* fs.readDirectoryEntries(parent).pipe(Effect.orElseSucceed(() => []))

    yield* Effect.forEach(
      entries.filter((entry) => entry.type === "directory" && entry.name.startsWith("jabisu-")),
      (entry) =>
        Effect.gen(function* () {
          const directory = path.join(parent, entry.name)

          if (directory === root) return
          const written = Option.getOrUndefined((yield* fs.stat(directory)).mtime)?.getTime() ?? now

          if (now - written > STALE_MS) yield* fs.remove(directory, { recursive: true })
        }).pipe(Effect.ignore),
    )

    // Copies the user made by hand count as made from this version, so a later change of that skill is noticed.
    yield* JabisuSkills.baseline({ fs, global }, JabisuSkills.bundled(contents))

    const skills = contents.flatMap((file) => {
      if (path.posix.basename(file.path) !== "SKILL.md" || typeof file.content !== "string") return []
      const parsed = SkillFile.parse(root, path.join(root, file.path), file.content)

      return parsed._tag === "Parsed" ? [parsed.skill] : []
    })

    // Runs after the built-in skills and before configured ones, so a user's skill with the same name replaces these.
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
    // FilmCraft's remote control needs its token, which is made only once FilmCraft is installed.
    const filmcraft = FilmCraft.cli(process.env.ProgramFiles ?? "C:\\Program Files")
    const filmcraftServer = (yield* fs.exists(filmcraft).pipe(Effect.orElseSucceed(() => false)))
      ? yield* FilmCraft.token(fs, FilmCraft.tokenFile(global.data)).pipe(
          Effect.map((token) => FilmCraft.server(filmcraft, token)),
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to prepare FilmCraft's remote control", { cause }).pipe(Effect.as(undefined)),
          ),
        )
      : undefined

    // Configured servers are applied before this plugin, so a configured context7 or filmcraft is kept as it is.
    yield* ctx.mcp.transform((editor) => {
      if (!editor.get("context7"))
        editor.set("context7", { type: "remote", url: "https://mcp.context7.com/mcp", disabled: true })

      if (filmcraftServer && !editor.get("filmcraft")) editor.set("filmcraft", filmcraftServer)
    })

    // A 집현전's sessions search its sources; its AGENTS.md, loaded as their instructions, says to use the tool and cite.
    const agents = yield* fs
      .readFileStringSafe(path.join(ctx.location.directory, "AGENTS.md"))
      .pipe(Effect.orElseSucceed(() => undefined))
    if (agents && Jiphyeonjeon.isJiphyeonjeon(agents)) {
      // A 집현전 made by an older version gets this version's rules before its sessions read them.
      yield* Jiphyeonjeon.refresh({ fs, global }, ctx.location.directory, agents)
      yield* ctx.tool.transform((editor) => editor.add(SourceSearch.tool({ fs, global }, ctx.location.directory)))
    }
  }),
})
