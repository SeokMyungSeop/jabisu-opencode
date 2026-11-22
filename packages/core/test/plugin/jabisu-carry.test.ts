import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Carry } from "@opencode/core/plugin/jabisu/carry"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { globalProjectNode } from "../lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionTransfer.node,
      FSUtil.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

describe("Carry", () => {
  it.live("packs a 작업실's conversations into its folder and reads them in where the folder is opened", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const deps = { fs: yield* FSUtil.Service, sessions, transfer: yield* SessionTransfer.Service }
      const here = (yield* tmpdirScoped()).path
      const there = (yield* tmpdirScoped()).path
      const location = Location.Ref.make({ directory: AbsolutePath.make(here) })
      const budget = yield* sessions.create({ location, title: "예산안 정리" })
      yield* sessions.create({ location, title: "회의록" })
      yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(there) }),
        title: "다른 작업실",
      })

      // Nothing is in the folder until the user packs.
      expect(yield* Carry.count(deps, here)).toBe(0)
      const packed = yield* Carry.pack(deps, here)

      expect(packed).toEqual({ packed: 2, folder: Carry.folder(here) })
      expect(yield* Carry.count(deps, here)).toBe(2)
      expect(yield* Effect.promise(() => fs.readFile(path.join(Carry.folder(here), "읽어 보세요.txt"), "utf8"))).toContain(
        "남에게 보내면 대화도 함께 갑니다",
      )

      // Here they already exist, so opening the folder again brings nothing twice.
      expect(yield* Carry.unpack(deps, here)).toEqual({ brought: [], kept: 2, failed: 0 })

      // The folder moves to another PC: the same files under another path, and no such conversations yet.
      yield* Effect.promise(() => fs.cp(path.join(here, ".jabisu"), path.join(there, ".jabisu"), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(Carry.folder(there), "broken.json"), "{"))
      yield* sessions.remove(budget.id)

      expect(yield* Carry.unpack(deps, there)).toEqual({ brought: [budget.id], kept: 1, failed: 1 })
      const arrived = yield* sessions.get(budget.id)

      expect(arrived.title).toBe("예산안 정리")
      expect(path.resolve(arrived.location.directory)).toBe(path.resolve(there))

      // A conversation deleted since the last packing no longer travels.
      expect((yield* Carry.pack(deps, here)).packed).toBe(1)
      expect(yield* Carry.count(deps, here)).toBe(1)
    }),
  )
})
