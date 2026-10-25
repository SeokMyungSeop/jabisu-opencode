import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, type Types } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { JabisuPlugin } from "@opencode/core/plugin/jabisu"
import { JabisuBundle } from "@opencode/core/plugin/jabisu/bundle"
import { FilmCraft } from "@opencode/core/plugin/jabisu/filmcraft"
import { Jiphyeonjeon } from "@opencode/core/plugin/jabisu/jiphyeonjeon"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import type { Mcp } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node, FSUtil.node])))

// Runs the plugin on one channel over the given configured MCP servers, with its cache in a temporary directory, at
// the given Location directory or the host's default one.
const run = (channel: string, servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>>, directory?: string) =>
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const cache = (yield* tmpdirScoped()).path
    const data = (yield* tmpdirScoped()).path
    const base = host()
    const tools: string[] = []

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
    ).pipe(Effect.provideService(Global.Service, Global.make({ cache, data })))

    return { skills: yield* skill.list(), servers, data, tools }
  })

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
      const { skills, data } = yield* run("jabisu", {})
      const read = (file: string) => Effect.promise(() => fs.readFile(file))
      const directory = (name: string) => path.dirname(skills.find((skill) => String(skill.id) === name)?.path ?? "")

      for (const name of ["docx", "hwpx", "pptx", "xlsx"]) {
        const helper = (yield* read(path.join(directory(name), "scripts/jabisu_python.py"))).toString("utf8")
        expect(helper).toContain(`ROOT = r"${path.join(data, "jabisu", "python")}"`)
        expect(yield* read(path.join(directory(name), "python-setup.md"))).toEqual(
          yield* read(source("python/python-setup.md")),
        )
      }
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
      expect(yield* Effect.promise(() => fs.access(FilmCraft.tokenFile(data)).then(() => true, () => false))).toBe(false)
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

      expect((yield* run("jabisu", {}, directory)).tools).toEqual(["source_search"])
      expect((yield* run("jabisu", {})).tools).toEqual([])
    }),
  )
})
