/// <reference path="../markdown.d.ts" />
/// <reference path="./jabisu/assets.d.ts" />

export * as JabisuPlugin from "./jabisu.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Effect, Option, Stream } from "effect"
import { HttpClient } from "effect/http"
import path from "path"
import { SkillFile } from "../config/plugin/skill-file.js"
import { Watcher } from "../filesystem/watcher.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { FilmCraft } from "./jabisu/filmcraft.js"
import { Jiphyeonjeon } from "./jabisu/jiphyeonjeon.js"
import { LawTools } from "./jabisu/law/tools.js"
import { JabisuSafety } from "./jabisu/safety.js"
import { SkillCatalog } from "./jabisu/skill-catalog.js"
import { SkillTurnOn } from "./jabisu/skill-turn-on.js"
import { JabisuSkills } from "./jabisu/skills.js"
import { SourceSearch } from "./jabisu/source-search.js"
import { WorkProfile } from "./jabisu/work/profile.js"
import { WorkSearch } from "./jabisu/work/search-tool.js"

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

    // Each bundled skill by its folder name, which the catalog and the user's choices use.
    const skills = contents.flatMap((file) => {
      if (path.posix.basename(file.path) !== "SKILL.md" || typeof file.content !== "string") return []
      const parsed = SkillFile.parse(root, path.join(root, file.path), file.content)

      return parsed._tag === "Parsed" ? [{ folder: path.posix.dirname(file.path), skill: parsed.skill }] : []
    })

    // Skills that are off stay installed but are not offered to the model, which suggests them from a short list
    // instead; the user's choices apply as soon as they change.
    const choices = { value: yield* JabisuSkills.chosen({ fs, global }) }
    const off = () => skills.flatMap(({ folder }) => (SkillCatalog.isOn(folder, choices.value) ? [] : [folder]))

    // The AI asks before it changes files outside the 작업실 or deletes files. Runs after the built-in agents are made
    // and before configured ones, so a user's own permission rules still have the last word.
    yield* ctx.agent.transform((editor) => {
      for (const agent of editor.list())
        editor.update(agent.id, (item) =>
          item.permissions.push(...JabisuSafety.tightening(item.permissions).map((rule) => ({ ...rule }))),
        )
    })

    // Runs after the built-in skills and before configured ones, so a user's skill with the same name replaces these.
    yield* ctx.skill.transform((editor) => {
      const hidden = new Set(off())

      for (const { folder, skill } of skills) editor.add(hidden.has(folder) ? { ...skill, autoinvoke: false } : skill)
    })
    yield* ctx.tool.transform((editor) => editor.add(SkillTurnOn.tool({ fs, global })))
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

    // Every session can find files in the work folders the user chose; the server's indexer keeps them indexed.
    yield* ctx.tool.transform((editor) => editor.add(WorkSearch.tool(global)))

    // Every session can look up laws in the official database and check the articles an answer cites.
    const http = yield* HttpClient.HttpClient
    const law = LawTools.tools({ fs, global, http })
    yield* ctx.tool.transform((editor) => {
      editor.add(law.search)
      editor.add(law.text)
      editor.add(law.verify)
    })

    // The work folder is there from the start, so the user can open it and keep the duty assignment table in it.
    yield* fs
      .ensureDir(WorkProfile.folder(global))
      .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to make the work folder", { cause })))

    // The user's work profile is part of every session's instructions, and an edit to it applies at once.
    const discovery = yield* InstructionDiscovery.Service
    const watcher = yield* Watcher.Service
    const profileFile = WorkProfile.file(global)
    const profile = { content: undefined as string | undefined }
    const readProfile = fs.readFileStringSafe(profileFile).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.tap((content) => Effect.sync(() => void (profile.content = content))),
    )

    yield* readProfile
    yield* (yield* watcher.subscribe({ path: profileFile, type: "file" })).pipe(
      Stream.debounce("200 millis"),
      Stream.runForEach(() => readProfile.pipe(Effect.andThen(discovery.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* discovery.transform((editor) => {
      if (profile.content?.trim())
        editor.add(
          new InstructionDiscovery.File({
            path: profileFile,
            content: WorkProfile.instructions(profileFile, profile.content),
          }),
        )
    })

    // The skills that are off, for the model to offer; a skill the user copied is theirs and always on.
    const switchesFile = JabisuSkills.switches(global)
    const offered = { content: undefined as string | undefined }
    const readSwitches = Effect.gen(function* () {
      choices.value = yield* JabisuSkills.chosen({ fs, global })
      const copied = yield* Effect.forEach(off(), (name) =>
        fs
          .existsSafe(path.join(JabisuSkills.folder(global), name, "SKILL.md"))
          .pipe(Effect.map((has) => [name, has] as const)),
      )

      offered.content = SkillCatalog.offered(copied.flatMap(([name, has]) => (has ? [] : [name])))
    })

    yield* readSwitches
    yield* (yield* watcher.subscribe({ path: switchesFile, type: "file" })).pipe(
      Stream.debounce("200 millis"),
      Stream.runForEach(() =>
        readSwitches.pipe(Effect.andThen(ctx.skill.reload()), Effect.andThen(discovery.reload())),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* discovery.transform((editor) => {
      if (offered.content) editor.add(new InstructionDiscovery.File({ path: switchesFile, content: offered.content }))
    })

    // What a command can do that no permission rule sees, such as working around a refusal, is ruled out in words.
    yield* discovery.transform((editor) =>
      editor.add(
        new InstructionDiscovery.File({
          path: path.join(global.config, "jabisu-safety"),
          content: JabisuSafety.INSTRUCTIONS,
        }),
      ),
    )
  }),
})
