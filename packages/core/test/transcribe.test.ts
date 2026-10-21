import { describe, expect, test } from "bun:test"
import { Transcribe } from "@opencode/core/tool/transcribe"

describe("Transcribe.normalize", () => {
  test("turns second ranges with zero-based speakers into clock lines numbered from 1", () => {
    expect(Transcribe.normalize("0.13-1.72 | SPEAKER_00: 안녕하세요.\n65.4-70 | SPEAKER_01: 네.", 300)).toBe(
      "[00:05:00] 화자 1: 안녕하세요.\n[00:06:05] 화자 2: 네.",
    )
  })

  test("keeps the first real time when a line carries several", () => {
    expect(
      Transcribe.normalize(
        [
          "[00:05] 화자 1: 시작합니다.",
          "00:00-00:08 [00:12] 화자 2: 좋습니다.",
          "[00:20] [00:00:00] 화자 1: 다음 안건입니다.",
          "[00:00:31.50] 화자 2: 네.",
        ].join("\n"),
        0,
      ),
    ).toBe(
      [
        "[00:00:05] 화자 1: 시작합니다.",
        "[00:00:00] 화자 2: 좋습니다.",
        "[00:00:20] 화자 1: 다음 안건입니다.",
        "[00:00:31] 화자 2: 네.",
      ].join("\n"),
    )
  })

  test("gives a time on its own line to the next words and drops a copied placeholder", () => {
    expect(
      Transcribe.normalize(
        ["00:00-00:04", "[mm:ss] 화자 1: 액체 주석.", "00:06-00:34", "[mm:ss] 화자 2: 네, 맞습니다."].join("\n"),
        60,
      ),
    ).toBe(["[00:01:00] 화자 1: 액체 주석.", "[00:01:06] 화자 2: 네, 맞습니다."].join("\n"))
  })

  test("continues the last time for plain lines, skips code fences, and leaves times inside words alone", () => {
    expect(
      Transcribe.normalize(
        ["```", "[01:02:03] 화자 1: 첫 줄", "이어지는 말", "12:30에 다시 모입니다.", "```"].join("\n"),
        0,
      ),
    ).toBe(["[01:02:03] 화자 1: 첫 줄", "[01:02:03] 이어지는 말", "[01:02:03] 12:30에 다시 모입니다."].join("\n"))
  })
})
