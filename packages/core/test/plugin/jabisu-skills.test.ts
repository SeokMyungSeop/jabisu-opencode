import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { JabisuSkills } from "@opencode/core/plugin/jabisu/skills"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

const setup = Effect.gen(function* () {
  const config = (yield* tmpdirScoped()).path
  const data = (yield* tmpdirScoped()).path

  return { config, deps: { fs: yield* FSUtil.Service, global: Global.make({ config, data }) } }
})

const statusOf = (deps: JabisuSkills.Dependencies, name: string) =>
  JabisuSkills.list(deps).pipe(Effect.map((list) => list.skills.find((skill) => skill.name === name)?.status))

describe("JabisuSkills", () => {
  it.live("lists every bundled skill as the default one until the user copies it", () =>
    Effect.gen(function* () {
      const { config, deps } = yield* setup
      const list = yield* JabisuSkills.list(deps)

      expect(list.folder).toBe(path.join(config, "skills"))
      expect(list.skills.map((skill) => skill.name)).toContain("hwpx")
      expect(list.skills.every((skill) => skill.status === "default" && skill.directory === undefined)).toBe(true)
      expect(list.skills.find((skill) => skill.name === "craft-apps")?.description).toContain("Craft")
    }),
  )

  it.live("copies a skill with all its files and its base version, once", () =>
    Effect.gen(function* () {
      const { config, deps } = yield* setup
      const directory = yield* JabisuSkills.copy(deps, "hwpx")
      const hwpx = JabisuSkills.bundled(yield* JabisuSkills.files(deps)).find((skill) => skill.name === "hwpx")!

      expect(directory).toBe(path.join(config, "skills", "hwpx"))
      for (const file of hwpx.files)
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, file.path)))).toEqual(
          Buffer.from(file.content),
        )
      expect(yield* Effect.promise(() => fs.readFile(path.join(directory, JabisuSkills.BASE), "utf8"))).toBe(
        hwpx.version,
      )
      expect(yield* statusOf(deps, "hwpx")).toBe("custom")

      const again = yield* JabisuSkills.copy(deps, "hwpx").pipe(Effect.flip)
      expect(again.reason).toContain("already exists")
    }),
  )

  it.live("notices a copy of an older version, and stops asking once the user keeps it", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const directory = yield* JabisuSkills.copy(deps, "docx")

      yield* Effect.promise(() => fs.writeFile(path.join(directory, JabisuSkills.BASE), "an older version"))
      expect(yield* statusOf(deps, "docx")).toBe("changed")

      yield* JabisuSkills.keep(deps, "docx")
      expect(yield* statusOf(deps, "docx")).toBe("custom")
    }),
  )

  it.live("goes back to the bundled skill by moving the copy into the backup folder", () =>
    Effect.gen(function* () {
      const { config, deps } = yield* setup
      const directory = yield* JabisuSkills.copy(deps, "xlsx")

      yield* Effect.promise(() => fs.writeFile(path.join(directory, "SKILL.md"), "---\nname: xlsx\n---\n내 것\n"))
      const backup = yield* JabisuSkills.reset(deps, "xlsx", new Date(2026, 9, 26, 10, 15, 0))

      expect(backup).toBe(path.join(config, "skills-backup", "xlsx-20261026-101500"))
      expect(yield* Effect.promise(() => fs.readFile(path.join(backup, "SKILL.md"), "utf8"))).toContain("내 것")
      expect(yield* Effect.promise(() => fs.access(directory).then(() => true, () => false))).toBe(false)
      expect(yield* statusOf(deps, "xlsx")).toBe("default")
    }),
  )

  it.live("refuses names that are not bundled skills", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const error = yield* JabisuSkills.copy(deps, "../outside").pipe(Effect.flip)

      expect(error.reason).toContain("not a bundled skill")
    }),
  )
})
