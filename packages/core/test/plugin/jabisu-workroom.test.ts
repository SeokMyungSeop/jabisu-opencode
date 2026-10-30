import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Workroom } from "@opencode/core/plugin/jabisu/workroom"
import type { Session } from "@opencode/core/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(LayerNode.compile(FSUtil.node))

// A home of its own, so the 작업실 root is a temporary `Documents/자비수 작업실`.
const setup = Effect.gen(function* () {
  const home = (yield* tmpdirScoped()).path
  const deps = {
    fs: yield* FSUtil.Service,
    global: Global.make({ home, config: path.join(home, "config"), cache: path.join(home, "cache") }),
  }
  return { deps, root: path.join(home, "Documents", "자비수 작업실") }
})

describe("Workroom", () => {
  it.live("names a 작업실 after the first attached file, without a recorder's date and time", () =>
    Effect.sync(() => {
      expect(
        Workroom.name({
          text: "이 녹음으로 회의록 만들어 줘",
          files: ["음성 261028_100642_초광역특구 설명회 참석.m4a"],
        }),
      ).toBe("초광역특구 설명회 참석")
      expect(Workroom.name({ text: "", files: ["3분기 집행 현황.xlsx", "참고.hwpx"] })).toBe("3분기 집행 현황")
    }),
  )

  it.live("names a 작업실 after what the request is about when nothing is attached", () =>
    Effect.sync(() => {
      expect(Workroom.name({ text: "3분기 예산 집행 점검 보고서를 만들어 줘", files: [] })).toBe(
        "3분기 예산 집행 점검 보고서",
      )
      expect(Workroom.name({ text: "바이오 기업 간담회 자료 정리해 주세요.\n참석자는 5명", files: [] })).toBe(
        "바이오 기업 간담회 자료",
      )
      expect(Workroom.name({ text: "이 공문 요약해줘", files: [] })).toBe("공문")
      expect(
        Workroom.name({ text: "출장 메모 정리해 줘. 이 폴더 안에서만 일해: 메모.txt를 만들어.", files: [] }),
      ).toBe("출장 메모")
      expect(Workroom.name({ text: "주간 회의 안내문 제목 하나만 지어 줘. 도구는 쓰지 마.", files: [] })).toBe(
        "주간 회의 안내문 제목",
      )
      expect(Workroom.name({ text: "부서별 예산 집행률 점검 보고서 만들어줘", files: [] })).toBe(
        "부서별 예산 집행률 점검 보고서",
      )
      expect(Workroom.name({ text: "회의록 좀 요약해 주세요", files: [] })).toBe("회의록")
      expect(Workroom.name({ text: "동해안 해양 축제 계획", files: [] })).toBe("동해안 해양 축제 계획")
    }),
  )

  it.live("keeps the name a Windows folder name and falls back to 「새 작업실」", () =>
    Effect.sync(() => {
      expect(Workroom.name({ text: '보고서: "초안" <1차> 정리해 줘', files: [] })).toBe("보고서 초안 1차")
      expect(Workroom.name({ text: "하이", files: [] })).toBe("하이")
      expect(Workroom.name({ text: "?", files: [] })).toBe("새 작업실")
      expect(Workroom.name({ text: "con", files: [] })).toBe("새 작업실")
      expect(
        Workroom.name({
          text: "가나다라 마바사아 자차카타 파하가나 다라마바 사아자차 카타파하 가나다라 마바사아 자차카타",
          files: [],
        }),
      ).toBe("가나다라 마바사아 자차카타 파하가나 다라마바 사아자차 카타파하 가나다라")
    }),
  )

  it.live("makes the folder under 자비수 작업실 and numbers a name already taken", () =>
    Effect.gen(function* () {
      const { deps, root } = yield* setup
      expect(yield* Workroom.ensureRoot(deps)).toBe(root)

      const first = yield* Workroom.create(deps, { text: "회의록 만들어 줘", files: [] })
      const second = yield* Workroom.create(deps, { text: "회의록 만들어 줘", files: [] })

      expect(first).toEqual({ directory: path.join(root, "회의록"), name: "회의록" })
      expect(second).toEqual({ directory: path.join(root, "회의록 (2)"), name: "회의록 (2)" })
      expect((yield* Effect.promise(() => fs.stat(second.directory))).isDirectory()).toBe(true)
    }),
  )

  it.live("takes a typed name as Windows takes a folder name, and refuses one it cannot use", () =>
    Effect.sync(() => {
      expect(Workroom.typed("  초광역특구 설명회. ")).toBe("초광역특구 설명회")
      expect(Workroom.typed("보고서 (2)")).toBe("보고서 (2)")
      for (const refused of ["", " . ", "a/b", "회의:록", "CON", ".숨김", "가".repeat(61)])
        expect(Workroom.typed(refused)).toBeUndefined()
    }),
  )

  it.live("leaves a 작업실 as it is while one of its conversations is working", () =>
    Effect.gen(function* () {
      const { deps, root } = yield* setup
      const folder = path.join(root, "회의록")
      yield* Effect.promise(() => fs.mkdir(folder, { recursive: true }))
      const released: string[] = []
      // SAFETY: renaming reads only the ID of a conversation it lists.
      const working = { id: "ses_working" } as unknown as Session.Info

      const refused = yield* Workroom.rename(
        {
          ...deps,
          sessions: {
            list: () => Effect.succeed({ data: [working], cursor: {} }),
            move: () => Effect.die("a working conversation moved"),
            active: Effect.succeed(new Set([working.id])),
          },
          release: (directory) => Effect.sync(() => void released.push(directory)),
        },
        { directory: folder, name: "회의록 정리" },
      ).pipe(Effect.flip)

      expect(refused).toMatchObject({ kind: "busy" })
      expect(released).toEqual([])
      expect((yield* Effect.promise(() => fs.stat(folder))).isDirectory()).toBe(true)
    }),
  )
})
