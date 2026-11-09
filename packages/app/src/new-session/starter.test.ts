import { describe, expect, test } from "bun:test"
import { dict as en } from "@/runtime/i18n/en"
import { dict as ko } from "@/runtime/i18n/ko"
import { STARTERS, starterPrompt, starterRoom } from "./starter"

const recording = { type: "path", id: "a", filename: "회의.m4a", mime: "audio/mp4", path: "C:/녹음/회의.m4a" } as const

describe("자비수 new-conversation chips", () => {
  test("every chip has a label and a frame of blanks in Korean and English", () => {
    const dicts: Record<string, string>[] = [en, ko]

    for (const starter of STARTERS)
      for (const dict of dicts) {
        expect(dict[`jabisu.starter.${starter}.label`]).toBeTruthy()
        expect(dict[`jabisu.starter.${starter}.frame`]).toContain("\n- ")
      }
  })

  test("fills the frame before the files already dropped in, with the caret after the first blank's label", () => {
    const frame = "보고서를 써 주세요.\n- 무엇을: (예: 민원 현황)\n- 누구에게: (예: 과장님)"
    const next = starterPrompt(frame, [{ type: "text", content: "", start: 0, end: 0 }, recording])

    expect(next.prompt).toEqual([{ type: "text", content: frame, start: 0, end: frame.length }, recording])
    expect(frame.slice(next.cursor)).toStartWith("(예: 민원 현황)")
  })

  test("shows only while the composer has no words", () => {
    expect(starterRoom([{ type: "text", content: "  ", start: 0, end: 2 }, recording])).toBe(true)
    expect(starterRoom([{ type: "text", content: "회의록", start: 0, end: 3 }])).toBe(false)
  })
})
