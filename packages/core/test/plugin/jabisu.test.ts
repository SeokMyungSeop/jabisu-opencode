import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, type Types } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { JabisuPlugin } from "@opencode/core/plugin/jabisu"
import { JabisuBundle } from "@opencode/core/plugin/jabisu/bundle"
import { Skill } from "@opencode/core/skill"
import type { Mcp } from "@opencode/schema/mcp"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node, FSUtil.node])))

// Runs the plugin on one channel over the given configured MCP servers, with its cache in a temporary directory.
const run = (channel: string, servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>>) =>
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const cache = (yield* tmpdirScoped()).path
    const data = (yield* tmpdirScoped()).path
    const base = host()

    yield* JabisuPlugin.Plugin.effect(
      host({
        app: { name: "test", version: "1.1.0", channel },
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

    return { skills: yield* skill.list(), servers, data }
  })

const source = (file: string) => path.join(import.meta.dirname, "../../src/plugin/jabisu", file)

describe("JabisuPlugin.Plugin", () => {
  it.live("bundles its skills with their files and offers Context7 switched off on the jabisu channel", () =>
    Effect.gen(function* () {
      const { skills, servers } = yield* run("jabisu", {})
      const byId = new Map(skills.map((skill) => [String(skill.id), skill]))

      expect([...byId.keys()].toSorted()).toEqual([
        "codebase-design",
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
})
