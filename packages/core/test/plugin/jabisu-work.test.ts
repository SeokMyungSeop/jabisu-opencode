import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { openWorkDatabase } from "#jabisu-work-database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { WorkIndex } from "@opencode/core/plugin/jabisu/work/index"
import { WorkProfile } from "@opencode/core/plugin/jabisu/work/profile"
import { WorkSearch } from "@opencode/core/plugin/jabisu/work/search-tool"
import { WorkSettings } from "@opencode/core/plugin/jabisu/work/settings"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

const write = (file: string, content: string, modified?: Date) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
    if (modified) await fs.utimes(file, modified, modified)
  })

// A saved-work folder and an index of it in a separate data folder.
const setup = Effect.gen(function* () {
  const folder = (yield* tmpdirScoped()).path
  const data = (yield* tmpdirScoped()).path
  const config = (yield* tmpdirScoped()).path
  const file = WorkIndex.file({ data, config })

  yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
  const db = openWorkDatabase(file)!
  WorkIndex.migrate(db)
  WorkIndex.track(db, [{ folder, role: "saved" }])
  yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))

  return { folder, global: { data, config }, db }
})

const indexAll = (db: NonNullable<ReturnType<typeof openWorkDatabase>>) =>
  Effect.gen(function* () {
    while (yield* WorkIndex.extractNext(db));
  })

const names = (hits: readonly { path: string }[]) => hits.map((hit) => path.basename(hit.path)).toSorted()

describe("WorkIndex", () => {
  it.live("finds files by name and by document text, in Korean, with words of any length", () =>
    Effect.gen(function* () {
      const { folder, db } = yield* setup

      yield* write(path.join(folder, "디지털헬스케어", "중간보고(안).txt"), "AI기반 디지털헬스케어서비스 실증사업 중간 점검 결과")
      yield* write(path.join(folder, "과학벨트 기본계획.md"), "과학벨트 기능지구 육성 계획과 가속기 산업 클러스터")
      yield* write(path.join(folder, "사진.png"), "not a document")
      yield* write(path.join(folder, "~$잠금 파일.docx"), "office lock file")

      expect((yield* WorkIndex.scan(db, folder)).files).toBe(3)
      yield* indexAll(db)

      const search = (words: string[], where: WorkIndex.Query["where"] = "all") =>
        WorkIndex.search(db, { words, where, limit: 10 })

      expect(names(search(["헬스케어"], "name"))).toEqual(["중간보고(안).txt"])
      expect(names(search(["가속기", "클러스터"], "content"))).toEqual(["과학벨트 기본계획.md"])
      expect(search(["가속기"], "content")[0]?.snippet).toContain("«가속기»")
      // Two-letter words are below the trigram length and still match.
      expect(names(search(["점검"], "content"))).toEqual(["중간보고(안).txt"])
      expect(search(["없는말"])).toEqual([])
      // The chosen folder's own path never matches a name search.
      expect(search([path.basename(folder)], "name")).toEqual([])
    }),
  )

  it.live("lists the newest files, filtered by type and date, without words", () =>
    Effect.gen(function* () {
      const { folder, db } = yield* setup

      yield* write(path.join(folder, "old.txt"), "old", new Date(2026, 0, 5))
      yield* write(path.join(folder, "new.hwpx"), "x", new Date(2026, 9, 20))
      yield* write(path.join(folder, "newer.txt"), "y", new Date(2026, 9, 25))
      yield* WorkIndex.scan(db, folder)

      const recent = WorkIndex.search(db, { words: [], where: "all", limit: 10 })
      expect(recent.map((hit) => path.basename(hit.path))).toEqual(["newer.txt", "new.hwpx", "old.txt"])
      expect(recent.every((hit) => hit.match === "recent")).toBe(true)

      const october = WorkIndex.search(db, {
        words: [],
        where: "all",
        since: new Date(2026, 9, 1).getTime(),
        extensions: ["txt"],
        limit: 10,
      })
      expect(names(october)).toEqual(["newer.txt"])
    }),
  )

  it.live("follows changes: new, edited, renamed and deleted files and folders", () =>
    Effect.gen(function* () {
      const { folder, db } = yield* setup
      const report = path.join(folder, "보고서.txt")

      yield* write(report, "첫 번째 내용")
      yield* WorkIndex.scan(db, folder)
      yield* indexAll(db)

      yield* write(report, "고친 내용입니다")
      yield* WorkIndex.change(db, folder, report)
      expect(db.get<{ text_state: string }>("select text_state from files where path = ?", report)?.text_state).toBe("pending")
      yield* indexAll(db)
      expect(names(WorkIndex.search(db, { words: ["고친"], where: "content", limit: 5 }))).toEqual(["보고서.txt"])
      expect(WorkIndex.search(db, { words: ["첫"], where: "content", limit: 5 })).toEqual([])

      const moved = path.join(folder, "보관", "보고서-최종.txt")
      yield* Effect.promise(() => fs.mkdir(path.dirname(moved), { recursive: true }))
      yield* Effect.promise(() => fs.rename(report, moved))
      yield* WorkIndex.change(db, folder, report)
      yield* WorkIndex.change(db, folder, path.dirname(moved))
      expect(names(WorkIndex.search(db, { words: [], where: "all", limit: 5 }))).toEqual(["보고서-최종.txt"])

      yield* Effect.promise(() => fs.rm(path.dirname(moved), { recursive: true }))
      yield* WorkIndex.change(db, folder, path.dirname(moved))
      expect(WorkIndex.search(db, { words: [], where: "all", limit: 5 })).toEqual([])
    }),
  )

  it.live("reports each folder's role and coverage, searches by role, and drops a folder the user removed", () =>
    Effect.gen(function* () {
      const { folder, db } = yield* setup
      const received = (yield* tmpdirScoped()).path

      yield* write(path.join(folder, "a.txt"), "가나다")
      yield* write(path.join(folder, "b.txt"), "라마바")
      yield* write(path.join(folder, "c.zip"), "zip")
      yield* write(path.join(received, "받은 공문.txt"), "협조 요청")
      WorkIndex.track(db, [
        { folder: received, role: "received" },
        { folder, role: "saved" },
      ])
      yield* WorkIndex.scan(db, folder)
      yield* WorkIndex.extractNext(db)

      expect(WorkIndex.stats(db)).toEqual([
        { folder: received, role: "received", files: 0, documents: 0, ready: 0, pending: 0 },
        { folder, role: "saved", files: 3, documents: 2, ready: 1, pending: 1 },
      ])

      yield* WorkIndex.scan(db, received)
      expect(names(WorkIndex.search(db, { words: [], where: "all", role: "received", limit: 5 }))).toEqual([
        "받은 공문.txt",
      ])
      expect(WorkIndex.search(db, { words: ["공문"], where: "name", role: "saved", limit: 5 })).toEqual([])

      WorkIndex.track(db, [{ folder: received, role: "received" }])
      expect(WorkIndex.stats(db).map((row) => row.folder)).toEqual([received])
      expect(names(WorkIndex.search(db, { words: [], where: "all", limit: 5 }))).toEqual(["받은 공문.txt"])
    }),
  )

  it.live("tells the model how to find files, and what is not indexed yet", () =>
    Effect.gen(function* () {
      const { folder, global, db } = yield* setup

      yield* write(path.join(folder, "공문.txt"), "디지털헬스케어 실증사업 협조 요청")
      yield* WorkIndex.scan(db, folder)

      const tool = WorkSearch.tool(global)
      const before = yield* tool.execute({ query: "실증사업", where: "content" })
      expect(before.output.hits).toEqual([])
      expect(before.content).toContain("not indexed yet")

      yield* indexAll(db)
      const after = yield* tool.execute({ query: "실증사업" })
      expect(after.output.hits.map((hit) => path.basename(hit.path))).toEqual(["공문.txt"])
      expect(after.content).toContain(path.join(folder, "공문.txt"))
      expect(after.content).toContain("saved work")

      const empty = yield* WorkSearch.tool({ data: (yield* tmpdirScoped()).path, config: global.config }).execute({ query: "실증사업" })
      expect(empty.content).toContain("Settings → Preferences (환경 설정) → 업무 비서")
    }),
  )
})

describe("WorkSettings", () => {
  it.live("keeps each chosen folder once in one role, always indexes its own folder, and offers received folders", () =>
    Effect.gen(function* () {
      const config = (yield* tmpdirScoped()).path
      const home = (yield* tmpdirScoped()).path
      const deps = { fs: yield* FSUtil.Service, global: Global.make({ config, home }) }
      const jabisu = WorkProfile.folder({ home })
      const downloads = path.join(home, "Downloads")
      const work = path.join(home, "업무")

      expect(yield* WorkSettings.read(deps)).toEqual({ received: [], saved: [] })
      expect(yield* WorkSettings.roots(deps)).toEqual([])

      const saved = yield* WorkSettings.write(deps, { received: [downloads, `${downloads}\\`], saved: [work, downloads, jabisu] })
      expect(saved).toEqual({ received: [downloads], saved: [work] })
      expect(yield* WorkSettings.read(deps)).toEqual(saved)

      for (const name of [
        "Documents/자비수 업무",
        "Downloads",
        "Documents/세종 메신저 받은 파일",
        "Documents/카카오톡 받은 파일",
        "Documents/기타",
      ])
        yield* Effect.promise(() => fs.mkdir(path.join(home, name), { recursive: true }))

      expect(yield* WorkSettings.roots(deps)).toEqual([
        { folder: jabisu, role: "jabisu" },
        { folder: downloads, role: "received" },
        { folder: work, role: "saved" },
      ])
      expect((yield* WorkSettings.candidates(deps)).map((item) => [path.basename(item.path), item.kind])).toEqual([
        ["Downloads", "downloads"],
        ["세종 메신저 받은 파일", "messenger"],
        ["카카오톡 받은 파일", "messenger"],
      ])
    }),
  )
})
