import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, type Types } from "effect"
import { HttpClient } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { JabisuPlugin } from "@opencode/core/plugin/jabisu"
import { JabisuBundle } from "@opencode/core/plugin/jabisu/bundle"
import { FilmCraft } from "@opencode/core/plugin/jabisu/filmcraft"
import { JabisuSkills } from "@opencode/core/plugin/jabisu/skills"
import { Jiphyeonjeon } from "@opencode/core/plugin/jabisu/jiphyeonjeon"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Location } from "@opencode/core/location"
import { Agent } from "@opencode/core/agent"
import { Permission } from "@opencode/core/permission"
import { WorkProfile } from "@opencode/core/plugin/jabisu/work/profile"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import type { Mcp } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { host } from "./host"

// The plugin adds the work profile to instruction discovery and watches it, so both are part of the graph.
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Skill.node, FSUtil.node, InstructionDiscovery.node, Watcher.node]), [
    Watcher.node.replace(Watcher.testLayer),
  ]),
)

// The plugin only hands the HTTP client to the law tools, which these tests do not call.
const offline = HttpClient.make(() => Effect.die("these tests make no requests"))

// Runs the plugin on one channel over the given configured MCP servers, with its cache in a temporary directory, at
// the given Location directory or the host's default one.
const run = (
  channel: string,
  servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>>,
  directory?: string,
  folders: { readonly cache?: string; readonly config?: string; readonly home?: string } = {},
) =>
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const cache = folders.cache ?? (yield* tmpdirScoped()).path
    const data = (yield* tmpdirScoped()).path
    // The plugin reads the user's skills folder under config, so the test never sees the real one.
    const config = folders.config ?? (yield* tmpdirScoped()).path
    // The work profile lives under Documents in home, which tests also keep temporary.
    const home = folders.home ?? (yield* tmpdirScoped()).path
    const base = host()
    const tools: string[] = []
    // The default agent allows everything; a planning agent denies edits; an exploring one denies all but commands.
    const agents = [
      Agent.Info.default(Agent.defaultID),
      {
        ...Agent.Info.default(Agent.ID.make("plan")),
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      },
      {
        ...Agent.Info.default(Agent.ID.make("explore")),
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "allow" },
        ],
      },
    ] as Types.DeepMutable<Agent.Info>[]

    yield* JabisuPlugin.Plugin.effect(
      host({
        app: { name: "test", version: "1.1.0", channel },
        location: directory
          ? new Location.Info({ ...base.location, directory: AbsolutePath.make(directory) })
          : base.location,
        tool: {
          ...base.tool,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => [],
                get: () => undefined,
                namespace: () => {},
                add: (tool) => {
                  tools.push(tool.name)
                },
                update: () => {},
                remove: () => {},
              })

              return { dispose: Effect.void }
            }),
        },
        skill: { list: () => Effect.die("unused skill.list"), transform: skill.transform, reload: skill.reload },
        agent: {
          ...base.agent,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => agents,
                get: (id) => agents.find((agent) => agent.id === id),
                default: () => {},
                update: (id, update) => {
                  const agent = agents.find((item) => item.id === id)
                  if (agent) update(agent)
                },
                remove: () => {},
              })

              return { dispose: Effect.void }
            }),
        },
        mcp: {
          ...base.mcp,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => Object.entries(servers),
                get: (name) => servers[name],
                set: (name, server) => {
                  // SAFETY: the plugin hands over a fresh config object, which this fake owns from here on.
                  servers[name] = server as Types.DeepMutable<Mcp.ServerConfig>
                },
                update: (name, update) => {
                  const server = servers[name]
                  if (server) update(server)
                },
                remove: (name) => {
                  delete servers[name]
                },
              })

              return { dispose: Effect.void }
            }),
        },
      }),
    ).pipe(
      Effect.provideService(Global.Service, Global.make({ cache, data, config, home })),
      Effect.provideService(HttpClient.HttpClient, offline),
    )

    const instructions = yield* (yield* InstructionDiscovery.Service).list()

    return { skills: yield* skill.list(), servers, data, cache, config, home, tools, instructions, agents }
  })

const runWithCache = (cache?: string, config?: string) => run("jabisu", {}, undefined, { cache, config })

const source = (file: string) => path.join(import.meta.dirname, "../../src/plugin/jabisu", file)

// The plugin looks for FilmCraft under ProgramFiles, which tests point at a temporary folder for their scope.
const withProgramFiles = (directory: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.ProgramFiles
      process.env.ProgramFiles = directory
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.ProgramFiles
        else process.env.ProgramFiles = previous
      }),
  )

describe("JabisuPlugin.Plugin", () => {
  it.live("bundles its skills with their files and offers Context7 switched off on the jabisu channel", () =>
    Effect.gen(function* () {
      const { skills, servers } = yield* run("jabisu", {})
      const byId = new Map(skills.map((skill) => [String(skill.id), skill]))

      expect([...byId.keys()].toSorted()).toEqual([
        "admin-docs",
        "codebase-design",
        "craft-apps",
        "diagnosing-bugs",
        "docx",
        "grill-me",
        "grilling",
        "handoff",
        "hwpx",
        "pptx",
        "tdd",
        "work-profile",
        "xlsx",
      ])
      // grill-me is user-invoked only, as its frontmatter says.
      expect(byId.get("grill-me")?.autoinvoke).toBe(false)
      // tdd links tests.md beside it, so the file must exist next to the skill's path.
      const tdd = byId.get("tdd")
      expect(tdd?.content).toContain("[tests.md](tests.md)")
      expect(yield* Effect.promise(() => fs.readFile(path.join(path.dirname(tdd!.path), "tests.md"), "utf8"))).toBe(
        yield* Effect.promise(() => fs.readFile(source("skills/tdd/tests.md"), "utf8")),
      )
      expect(servers.context7).toEqual({ type: "remote", url: "https://mcp.context7.com/mcp", disabled: true })
    }),
  )

  it.live("gives each document skill the Python helper for the shared package folder, and copies binary files", () =>
    Effect.gen(function* () {
      const { skills, data, cache } = yield* run("jabisu", {})
      const read = (file: string) => Effect.promise(() => fs.readFile(file))
      const directory = (name: string) => path.dirname(skills.find((skill) => String(skill.id) === name)?.path ?? "")

      for (const name of ["admin-docs", "docx", "hwpx", "pptx", "xlsx"]) {
        const helper = (yield* read(path.join(directory(name), "scripts/jabisu_python.py"))).toString("utf8")
        expect(helper).toContain(`ROOT = r"${path.join(data, "jabisu", "python")}"`)
        expect(yield* read(path.join(directory(name), "python-setup.md"))).toEqual(
          yield* read(source("python/python-setup.md")),
        )
      }
      // The admin-docs builder can find the bundled hwpx skill from a user's copy through the bundles folder.
      expect((yield* read(path.join(directory("admin-docs"), "scripts/make_admin_doc.py"))).toString("utf8")).toContain(
        `BUNDLES = r"${path.join(cache, "skills")}"`,
      )
      expect(yield* read(path.join(directory("hwpx"), "assets/report-template.hwpx"))).toEqual(
        yield* read(source("skills/hwpx/assets/report-template.hwpx")),
      )
    }),
  )

  it.live("bundles every file in the skills folder", () =>
    Effect.gen(function* () {
      const present = (yield* Effect.promise(() =>
        fs.readdir(source("skills"), { recursive: true, withFileTypes: true }),
      ))
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path.relative(source("skills"), path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
        )

      // After adding or removing a skill file, regenerate the list with `bun run script/jabisu-bundle.ts`.
      expect(JabisuBundle.files.map((file) => file.path).toSorted()).toEqual(present.toSorted())
    }),
  )

  it.live("offers FilmCraft's remote control switched off when FilmCraft is installed, with one kept token", () =>
    Effect.gen(function* () {
      const programFiles = (yield* tmpdirScoped()).path
      const cli = path.join(programFiles, "FilmCraft", "filmcraft-cli.exe")

      yield* Effect.promise(() => fs.mkdir(path.dirname(cli), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(cli, ""))
      yield* withProgramFiles(programFiles)

      const { servers, data, skills } = yield* run("jabisu", {})
      const file = FilmCraft.tokenFile(data)
      const token = yield* Effect.promise(() => fs.readFile(file, "utf8"))

      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(servers.filmcraft).toEqual({
        type: "local",
        command: [cli, "mcp", "--bridge", `127.0.0.1:${FilmCraft.PORT}`],
        environment: { FILMCRAFT_CONTROL_TOKEN: token },
        disabled: true,
      })
      // The launcher reads the same token file itself and starts FilmCraft on the same port.
      const skill = skills.find((item) => String(item.id) === "craft-apps")
      const launcher = yield* Effect.promise(() =>
        fs.readFile(path.join(path.dirname(skill!.path), "scripts/start-filmcraft.ps1"), "utf8"),
      )
      expect(launcher).toContain(`$port = ${FilmCraft.PORT}`)
      expect(launcher).toContain(`'${file}'`)
      expect(launcher).not.toContain("__")

      // A FilmCraft started earlier keeps accepting the bridge, so the token stays.
      yield* Effect.promise(() => fs.writeFile(file, token))
      expect(yield* FilmCraft.token(yield* FSUtil.Service, file)).toBe(token)
    }),
  )

  it.live("offers no FilmCraft and makes no token when FilmCraft is not installed", () =>
    Effect.gen(function* () {
      yield* withProgramFiles((yield* tmpdirScoped()).path)

      const { servers, data } = yield* run("jabisu", {})

      expect(servers.filmcraft).toBeUndefined()
      expect(
        yield* Effect.promise(() =>
          fs.access(FilmCraft.tokenFile(data)).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false)
    }),
  )

  it.live("removes earlier versions' skill folders a day after they were written", () =>
    Effect.gen(function* () {
      const cache = (yield* tmpdirScoped()).path
      const old = path.join(cache, "skills", "jabisu-old")
      const recent = path.join(cache, "skills", "jabisu-recent")
      const other = path.join(cache, "skills", "someone-else")

      for (const directory of [old, recent, other])
        yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
      yield* Effect.promise(() => fs.utimes(old, twoDaysAgo, twoDaysAgo))
      yield* Effect.promise(() => fs.utimes(other, twoDaysAgo, twoDaysAgo))

      yield* runWithCache(cache)
      const left = (yield* Effect.promise(() => fs.readdir(path.join(cache, "skills")))).toSorted()

      expect(left.filter((name) => name !== "jabisu-old")).toEqual(left)
      expect(left).toContain("jabisu-recent")
      expect(left).toContain("someone-else")
      expect(left.filter((name) => name.startsWith("jabisu-")).length).toBe(2)
    }),
  )

  it.live("keeps configured copies of bundled skills and records their base version", () =>
    Effect.gen(function* () {
      const config = (yield* tmpdirScoped()).path
      const copy = path.join(config, "skills", "docx", "SKILL.md")

      yield* Effect.promise(() => fs.mkdir(path.dirname(copy), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(copy, "---\nname: docx\ndescription: my own\n---\n\n내 워드 스킬\n"))
      const { data } = yield* runWithCache(undefined, config)

      const base = yield* Effect.promise(() => fs.readFile(path.join(path.dirname(copy), JabisuSkills.BASE), "utf8"))
      const bundled = JabisuSkills.bundled(
        yield* JabisuSkills.files({ fs: yield* FSUtil.Service, global: Global.make({ config, data }) }),
      )

      expect(base).toBe(bundled.find((skill) => skill.name === "docx")?.version ?? "")
    }),
  )

  it.live("keeps a configured context7 as it is", () =>
    Effect.gen(function* () {
      const configured: Types.DeepMutable<Mcp.ServerConfig> = {
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "key" },
      }
      const { servers } = yield* run("jabisu", { context7: configured })

      expect(servers.context7).toBe(configured)
      expect(servers.context7).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "key" },
      })
    }),
  )

  it.live("adds nothing on other channels", () =>
    Effect.gen(function* () {
      const { skills, servers } = yield* run("prod", {})

      expect(skills).toEqual([])
      expect(servers).toEqual({})
    }),
  )

  it.live("offers the source search only in a 집현전", () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "AGENTS.md"), Jiphyeonjeon.agents("시험", "")))

      expect((yield* run("jabisu", {}, directory)).tools).toContain("source_search")
      expect((yield* run("jabisu", {})).tools).not.toContain("source_search")
    }),
  )
})

describe("JabisuPlugin work assistant", () => {
  it.live("gives every session the work file search and the law tools", () =>
    Effect.gen(function* () {
      const { tools } = yield* run("jabisu", {})

      expect(tools).toContain("work_search")
      expect(tools).toEqual(expect.arrayContaining(["law_search", "law_text", "law_verify"]))
      expect((yield* run("opencode", {})).tools).not.toContain("law_search")
    }),
  )

  it.live("makes the work folder, and adds the user's work profile to the instructions, nothing without one", () =>
    Effect.gen(function* () {
      const home = (yield* tmpdirScoped()).path
      const file = WorkProfile.file({ home })
      const isDir = (folder: string) =>
        fs.stat(folder).then(
          (info) => info.isDirectory(),
          () => false,
        )

      yield* run("local", {}, undefined, { home })
      expect(yield* Effect.promise(() => isDir(WorkProfile.folder({ home })))).toBe(false)

      // The list of skills that are off is always there; the profile joins it once the file exists.
      const profiles = (list: unknown) =>
        Array.isArray(list) ? list.filter((item: { path: string }) => item.path === file) : []

      expect(profiles((yield* run("jabisu", {}, undefined, { home })).instructions)).toEqual([])
      expect(yield* Effect.promise(() => isDir(WorkProfile.folder({ home })))).toBe(true)

      yield* Effect.promise(() => fs.writeFile(file, "# 내 업무\n\n## 주업무\n- 바이오산업 육성 기본계획 수립\n"))
      const [profile] = profiles((yield* run("jabisu", {}, undefined, { home })).instructions)

      expect(profile?.content).toContain("바이오산업 육성 기본계획 수립")
      expect(profile?.content).toContain("work_search")
    }),
  )

  it.live("keeps skills that are off out of the model's list, offers them in Korean, and turns one on for good", () =>
    Effect.gen(function* () {
      const config = (yield* tmpdirScoped()).path
      const first = yield* run("jabisu", {}, undefined, { config })
      const shown = (skills: readonly { name: string; autoinvoke?: boolean }[], name: string) =>
        skills.find((skill) => skill.name === name)?.autoinvoke !== false
      const offered = (list: unknown) =>
        Array.isArray(list)
          ? list.find((item: { path: string }) => item.path === JabisuSkills.switches({ config }))
          : undefined

      // Document skills stay on; a developer skill and the Craft apps one are installed but off.
      expect(shown(first.skills, "hwpx")).toBe(true)
      expect(shown(first.skills, "tdd")).toBe(false)
      expect(shown(first.skills, "craft-apps")).toBe(false)
      expect(first.skills.map((skill) => String(skill.name))).toContain("tdd")
      expect(first.tools).toContain("skill_turn_on")
      expect(offered(first.instructions)?.content).toContain("craft-apps: PC에 깔린 Craft 앱으로")
      expect(offered(first.instructions)?.content).not.toContain("- hwpx")

      yield* JabisuSkills.turn({ fs: yield* FSUtil.Service, global: Global.make({ config }) }, "tdd", true)
      const second = yield* run("jabisu", {}, undefined, { config })

      expect(shown(second.skills, "tdd")).toBe(true)
      expect(offered(second.instructions)?.content).not.toContain("- tdd")
    }),
  )

  it.live("asks before edits outside the 작업실 and before deleting, and never loosens a denial", () =>
    Effect.gen(function* () {
      const effect = (agents: readonly Agent.Info[], id: string, action: string, resource: string) =>
        Permission.evaluate(action, resource, agents.find((agent) => agent.id === id)?.permissions ?? []).effect

      const other = (yield* run("local", {})).agents
      expect(effect(other, "build", "edit", "C:/Users/me/Documents/a.hwpx")).toBe("allow")

      const { agents } = yield* run("jabisu", {})
      expect(effect(agents, "build", "edit", "보고서/초안.md")).toBe("allow")
      expect(effect(agents, "build", "edit", "C:/Users/me/Documents/자비수 업무/내 업무.md")).toBe("ask")
      expect(effect(agents, "build", "edit", "D:\\업무\\계획.hwpx")).toBe("ask")
      expect(effect(agents, "build", "edit", "//server/share/a.txt")).toBe("ask")
      expect(effect(agents, "build", "read", "C:/Users/me/Downloads/공문.pdf")).toBe("allow")
      expect(effect(agents, "build", "shell", "remove-item -Recurse C:/temp/x")).toBe("ask")
      expect(effect(agents, "build", "shell", "Move-Item a.txt b.txt")).toBe("ask")
      expect(effect(agents, "build", "shell", "Get-ChildItem C:/Users")).toBe("allow")
      expect(effect(agents, "build", "shell", "python make_report.py")).toBe("allow")
      // The ways a real model worked around a refusal in a test ask too.
      expect(effect(agents, "build", "shell", `cmd /c del "C:\\jabisu-t145\\project\\지울파일.txt"`)).toBe("ask")
      expect(
        effect(
          agents,
          "build",
          "shell",
          `powershell -NoProfile -Command "Remove-Item -LiteralPath 'C:\\jabisu-t145\\project\\지울파일.txt' -Force"`,
        ),
      ).toBe("ask")
      expect(effect(agents, "build", "shell", `printf '밖\\n' > "C:/jabisu-t145/outside/바깥.txt"`)).toBe("ask")
      expect(effect(agents, "build", "shell", `python -c "import os; os.remove('a.txt')"`)).toBe("ask")
      // Common commands that only read or report stay free.
      expect(effect(agents, "build", "shell", "ls -la C:/Users/me 2>&1")).toBe("allow")
      expect(effect(agents, "build", "shell", `git commit -m "fix typo"`)).toBe("allow")
      // A planning agent keeps denying edits, and an exploring one only gains questions for deleting commands.
      expect(effect(agents, "plan", "edit", "C:/a.txt")).toBe("deny")
      expect(effect(agents, "explore", "edit", "C:/a.txt")).toBe("deny")
      expect(effect(agents, "explore", "shell", "del a.txt")).toBe("ask")
    }),
  )

  it.live("tells every chat not to work around a refusal or search the user's folders", () =>
    Effect.gen(function* () {
      // Runs share instruction discovery, so the other channel goes first.
      expect((yield* run("local", {})).instructions).toEqual([])

      const { instructions } = yield* run("jabisu", {})
      const safety = Array.isArray(instructions)
        ? instructions.find((item: { content: string }) => item.content.startsWith("# 자비수 안전 규칙"))
        : undefined

      expect(safety?.content).toContain("다른 도구로 바꿔서 다시 하지 않는다")
      expect(safety?.content).toContain("work_search")
    }),
  )
})
