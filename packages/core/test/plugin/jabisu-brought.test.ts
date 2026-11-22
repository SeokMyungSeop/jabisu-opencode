import { describe, expect, test } from "bun:test"
import { Brought } from "@opencode/core/plugin/jabisu/work/brought"

const day = new Date(2026, 10, 22)

describe("Brought.add", () => {
  test("starts the file with its heading and the day it was brought", () => {
    const text = Brought.add(undefined, "## 지침\n[2026-01-02] - 답은 짧게.", day)

    expect(text).toStartWith("# 가져온 기억\n")
    expect(text).toContain("## 2026-11-22에 가져옴\n\n## 지침\n[2026-01-02] - 답은 짧게.\n")
  })

  test("takes the export out of the code block the other AI wrapped it in", () => {
    const text = Brought.add(undefined, "```markdown\n## 지침\n[unknown] - 존댓말.\n```\n이것이 전체 내용입니다.", day)

    expect(text).toContain("## 지침\n[unknown] - 존댓말.")
    expect(text).not.toContain("```")
    expect(text).not.toContain("전체 내용입니다")
  })

  test("keeps what was brought before", () => {
    const first = Brought.add(undefined, "첫 번째", new Date(2026, 10, 1))
    const second = Brought.add(first, "두 번째", day)

    expect(second).toContain("## 2026-11-01에 가져옴\n\n첫 번째")
    expect(second).toContain("## 2026-11-22에 가져옴\n\n두 번째")
    expect(second?.match(/# 가져온 기억/g)).toHaveLength(1)
  })

  test("adds nothing for an empty paste", () => {
    expect(Brought.add(undefined, "  \n", day)).toBeUndefined()
    expect(Brought.add("# 가져온 기억\n\n있던 것", "```\n\n```", day)).toBe("# 가져온 기억\n\n있던 것")
  })
})

describe("Brought.instructions", () => {
  test("cuts a long file and says where the rest is", () => {
    const text = Brought.instructions("C:/x/가져온 기억.md", "가".repeat(9_000))

    expect(text).toContain("(이하 생략: 전체는 C:/x/가져온 기억.md)")
    expect(text.length).toBeLessThan(8_500)
  })
})
