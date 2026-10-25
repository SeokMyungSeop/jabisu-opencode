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
import { JabisuBundle } from "./jabisu/bundle.js"
import { FilmCraft } from "./jabisu/filmcraft.js"
import { Jiphyeonjeon } from "./jabisu/jiphyeonjeon.js"
import { SourceSearch } from "./jabisu/source-search.js"
import pythonHelper from "./jabisu/python/jabisu_python.py" with { type: "text" }
import pythonSetup from "./jabisu/python/python-setup.md" with { type: "text" }

// 자비수(諮備秀) ships six of Matt Pocock's skills (mattpocock/skills 1.3.1, MIT — jabisu/LICENSE.mattpocock-skills),
// the hwpx skill (jkf87/hwpx-skill, MIT — jabisu/LICENSE.hwpx-skill), its own docx, xlsx, pptx and craft-apps skills,
// and offers Context7, and FilmCraft when it is installed, as MCP servers that stay off until the user turns them on.
// Other channels get none of these.

// The document skills share one Python package folder, which outlives the skill folder each update rewrites.
const PYTHON_SKILLS = ["docx", "hwpx", "pptx", "xlsx"]

export const Plugin = define({
  id: "jabisu.defaults",
  effect: Effect.fn(function* (ctx) {
    if (ctx.app.channel !== "jabisu") return
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const helper = pythonHelper.replace("__JABISU_PYTHON__", path.join(global.data, "jabisu", "python"))
    const filmcraftToken = FilmCraft.tokenFile(global.data)
    const contents = [
      // Binary files are embedded in the CLI, so failing to read one is a build defect.
      ...(yield* Effect.forEach(JabisuBundle.files, (file) =>
        Effect.gen(function* () {
          return {
            path: file.path,
            content: "text" in file ? file.text : yield* fs.readFile(file.file).pipe(Effect.orDie),
          }
        }),
      )),
      ...PYTHON_SKILLS.flatMap((skill) => [
        { path: `${skill}/scripts/jabisu_python.py`, content: helper },
        { path: `${skill}/python-setup.md`, content: pythonSetup },
      ]),
      { path: "craft-apps/scripts/start-filmcraft.ps1", content: FilmCraft.launcher(filmcraftToken) },
    ]
    // Skills point at their sibling files by relative path, so the bundle is written out once per content version.
    const root = path.join(
      global.cache,
      "skills",
      `jabisu-${Hash.fast(contents.map((file) => `${file.path}\0${Hash.fast(Buffer.from(file.content))}`).join("\0"))}`,
    )

    for (const file of contents) {
      const target = path.join(root, file.path)

      if (yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))) continue
      yield* fs
        .writeWithDirs(target, file.content)
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to write bundled skill file", { target, cause })))
    }

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
      ? yield* FilmCraft.token(fs, filmcraftToken).pipe(
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
