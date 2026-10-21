import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit } from "effect"
import { utils, write } from "xlsx"
import { Jiphyeonjeon } from "@opencode/core/plugin/jabisu/jiphyeonjeon"
import { SourceSearch } from "@opencode/core/plugin/jabisu/source-search"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(LayerNode.compile(FSUtil.node))

// A home of its own, so the 집현전 root is a temporary `Documents/자비수 집현전`.
const setup = Effect.gen(function* () {
  const home = (yield* tmpdirScoped()).path
  const deps = {
    fs: yield* FSUtil.Service,
    global: Global.make({ home, config: path.join(home, "config"), cache: path.join(home, "cache") }),
  }
  return { deps, root: path.join(home, "Documents", "자비수 집현전") }
})

const writeText = (file: string, text: string) => Effect.promise(() => fs.writeFile(file, text))

describe("Jiphyeonjeon", () => {
  it.live("makes a 집현전 with its rules and keeps the user's instructions under them", () =>
    Effect.gen(function* () {
      const { deps, root } = yield* setup
      const created = yield* Jiphyeonjeon.create(deps, { name: " 사업 계획 " })

      expect(created).toEqual({
        name: "사업 계획",
        directory: path.join(root, "사업 계획"),
        instructions: "",
        sources: [],
      })
      expect((yield* Effect.promise(() => fs.stat(path.join(root, "사업 계획", "자료")))).isDirectory()).toBe(true)

      const instructed = yield* Jiphyeonjeon.instruct(deps, {
        name: "사업 계획",
        instructions: "보고서 말투로 답한다.\n",
      })
      const agents = yield* Effect.promise(() => fs.readFile(path.join(root, "사업 계획", "AGENTS.md"), "utf8"))

      expect(instructed.instructions).toBe("보고서 말투로 답한다.")
      expect(agents.startsWith(Jiphyeonjeon.MARKER)).toBe(true)
      expect(agents).toContain("source_search")
      expect(agents.trimEnd().endsWith("## 지침\n\n보고서 말투로 답한다.")).toBe(true)

      // A folder without the marker is left out of the list.
      yield* Effect.promise(() => fs.mkdir(path.join(root, "그냥 폴더"), { recursive: true }))
      expect((yield* Jiphyeonjeon.list(deps)).items.map((item) => item.name)).toEqual(["사업 계획"])
    }),
  )

  it.live("refuses names that cannot name a folder and names already taken", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      yield* Jiphyeonjeon.create(deps, { name: "회의" })

      for (const name of ["", "a/b", "보고서?", "CON", "끝.", ".숨김"]) {
        const exit = yield* Jiphyeonjeon.create(deps, { name }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }
      const taken = yield* Jiphyeonjeon.create(deps, { name: "회의" }).pipe(Effect.flip)
      expect(taken.reason).toBe("회의 already exists")
    }),
  )

  it.live("finds words in text and documents with the link to cite, and says which sources it cannot read", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const { directory } = yield* Jiphyeonjeon.create(deps, { name: "예산" })
      const sources = path.join(directory, "자료")
      const workbook = utils.book_new()
      utils.book_append_sheet(
        workbook,
        utils.aoa_to_sheet([
          ["항목", "금액"],
          ["인건비 예산", 1500000],
        ]),
        "총괄",
      )
      yield* Effect.promise(() => fs.mkdir(path.join(sources, "표"), { recursive: true }))
      yield* Effect.promise(() =>
        Promise.all([
          fs.writeFile(path.join(sources, "메모.txt"), "첫 줄\n올해 인건비는 줄였다\n예산 인건비 확정\n"),
          fs.writeFile(path.join(sources, "표", "예산.xlsx"), write(workbook, { type: "buffer", bookType: "xlsx" })),
          fs.writeFile(path.join(sources, "그림.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
          fs.writeFile(path.join(sources, "회의.m4a"), Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])),
        ]),
      )

      const result = yield* Jiphyeonjeon.search(deps, directory, { query: "인건비 예산", limit: 10 })

      // The line with the whole query comes first, then lines with both words, then lines with one.
      expect(result.matches).toEqual([
        { file: "자료/표/예산.xlsx", location: "시트 총괄", line: 3, text: "인건비 예산,1500000" },
        { file: "자료/메모.txt", location: undefined, line: 3, text: "예산 인건비 확정" },
        { file: "자료/메모.txt", location: undefined, line: 2, text: "올해 인건비는 줄였다" },
      ])
      expect(result.files).toEqual([
        { file: "자료/메모.txt", matches: 2 },
        { file: "자료/표/예산.xlsx", matches: 1 },
      ])
      expect(result.searched).toBe(2)
      expect(result.skipped.map((item) => item.file)).toEqual(["자료/그림.png", "자료/회의.m4a"])
      expect(SourceSearch.toModelContent(result)).toContain(
        "자료/표/예산.xlsx - cite as [예산.xlsx · 위치](<자료/표/예산.xlsx>)\n  시트 총괄, line 3: 인건비 예산,1500000",
      )
      expect(yield* Jiphyeonjeon.sources(deps, { name: "예산" })).toEqual([
        { path: "그림.png", status: "unsupported", reason: "not a document or text file" },
        { path: "메모.txt", status: "ready" },
        { path: "표/예산.xlsx", status: "ready" },
        { path: "회의.m4a", status: "pending", reason: "not transcribed yet; read it once with the read tool" },
      ])
    }),
  )

  it.live("cites the page, chapter and article or numbered heading above a line, and takes sources in turn", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const { directory } = yield* Jiphyeonjeon.create(deps, { name: "계약" })
      const sources = path.join(directory, "자료")
      yield* writeText(
        path.join(sources, "[개정] 기준.txt"),
        [
          "제5장  수의계약 운영요령 ········ 162",
          "제5장 수의계약 운영요령",
          "2. 금액기준에 따른 1인 견적",
          "  추정가격 2천만 원 이하",
          "제25조(수의계약) 수의계약은 2천만 원 이하",
        ].join("\n"),
      )
      yield* writeText(
        path.join(sources, "법.txt"),
        ["## Page 3", "제33조(견적) 수의계약 견적서", "수의계약 대상"].join("\n"),
      )

      const result = yield* Jiphyeonjeon.search(deps, directory, { query: "수의계약", limit: 5 })

      // A contents line with dot leaders is no heading; each source gives its next line in turn.
      expect(result.matches.map((match) => [match.file, match.location, match.line])).toEqual([
        ["자료/[개정] 기준.txt", undefined, 1],
        ["자료/법.txt", "3쪽 · 제33조", 2],
        ["자료/[개정] 기준.txt", "제5장", 2],
        ["자료/법.txt", "3쪽 · 제33조", 3],
        ["자료/[개정] 기준.txt", "제5장 › 제25조", 5],
      ])
      const amounts = yield* Jiphyeonjeon.search(deps, directory, { query: "2천만", limit: 5 })
      expect(amounts.matches.map((match) => match.location)).toEqual([
        "제5장 › 2. 금액기준에 따른 1인 견적",
        "제5장 › 제25조",
      ])
      expect(SourceSearch.citation("자료/[개정] 기준.txt")).toBe("[개정 기준.txt · 위치](<자료/[개정] 기준.txt>)")
    }),
  )

  it.live("reads chapters and sections marked as Markdown headings, as Hangul documents read", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const { directory } = yield* Jiphyeonjeon.create(deps, { name: "기준" })
      yield* writeText(
        path.join(directory, "자료", "기준.txt"),
        [
          "### 제5장 수의계약 운영요령",
          "### 제2절 수의계약 유형별 구분",
          "| 2천만 원 이하 |",
          "2. 금액기준",
          "2천만 원",
        ].join("\n"),
      )

      const result = yield* Jiphyeonjeon.search(deps, directory, { query: "2천만", limit: 5 })

      expect(result.matches.map((match) => match.location)).toEqual(["제5장 › 제2절", "제5장 › 2. 금액기준"])
    }),
  )

  it.live("brings an older 집현전's rules up to date and keeps the user's instructions", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const { directory } = yield* Jiphyeonjeon.create(deps, { name: "옛 집현전" })
      const file = path.join(directory, "AGENTS.md")
      yield* writeText(
        file,
        [Jiphyeonjeon.MARKER, "# 집현전: 옛 집현전", "", "- 옛 규칙", "", "## 지침", "", "짧게 답한다.", ""].join(
          "\r\n",
        ),
      )

      const listed = yield* Jiphyeonjeon.list(deps)

      expect(listed.items[0].instructions).toBe("짧게 답한다.")
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(
        Jiphyeonjeon.agents("옛 집현전", "짧게 답한다."),
      )
    }),
  )

  it.live("asks the model for P-C-T-F instructions written from the sources, without saving them", () =>
    Effect.gen(function* () {
      const { deps } = yield* setup
      const { directory } = yield* Jiphyeonjeon.create(deps, { name: "계약" })
      yield* writeText(
        path.join(directory, "자료", "기준.txt"),
        "제5장 수의계약 운영요령\n제25조(수의계약) 2천만 원 이하",
      )
      const prompts: string[] = []
      const answer = ["P(역할): 지방계약 전문가", "C(맥락): 계약 담당자", "T(작업): 조문 확인", "F(답변 양식): □ 결론"]

      const text = yield* Jiphyeonjeon.suggest(deps, { name: "계약" }, (prompt) => {
        prompts.push(prompt)
        return Effect.succeed(["```", ...answer, "```"].join("\n"))
      })

      expect(text).toBe(answer.join("\n"))
      expect(prompts[0]).toContain("## 기준.txt\n제5장 수의계약 운영요령\n제25조(수의계약) 2천만 원 이하")
      expect(prompts[0]).toContain("F(답변 양식)")
      const agents = yield* Effect.promise(() => fs.readFile(path.join(directory, "AGENTS.md"), "utf8"))
      expect(Jiphyeonjeon.instructions(agents)).toBe("")

      const empty = yield* Jiphyeonjeon.create(deps, { name: "빈 곳" })
      const refused = yield* Jiphyeonjeon.suggest(deps, { name: empty.name }, () => Effect.succeed("")).pipe(
        Effect.flip,
      )
      expect(refused.reason).toContain("add sources first")
    }),
  )
})
